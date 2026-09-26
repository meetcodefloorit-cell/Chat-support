import asyncio
import logging
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.exc import IntegrityError, TimeoutError as SATimeoutError
from sqlalchemy import select

from app.api import api_router
from app.api.realtime import broadcast_chat_session_update, broadcast_notification_counts, schedule_post_message_broadcasts
from app.core.config import settings
from app.core.paths import UPLOADS_DIR
from app.core.deps import ensure_project_access, validate_user_session
from app.core.logging import configure_logging
from app.core.security import TokenPayloadError, decode_access_token
from app.core.websocket_manager import manager
from app.db.session import SessionLocal, engine
from app.models import Conversation, ConversationType, MessageType, PresenceEventType, Project, User, UserRole
from app.schemas import MessageOut
from app.services import chat_session_service, conversation_service, notification_service, presence_service
from app.services.chat_session_scheduler import start_chat_session_scheduler, stop_chat_session_scheduler

configure_logging()
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name)

os.makedirs(UPLOADS_DIR, exist_ok=True)
app.mount("/api/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

cors_kwargs: dict = {
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if settings.cors_allow_all:
    cors_kwargs["allow_origins"] = ["*"]
    cors_kwargs["allow_credentials"] = False
else:
    cors_kwargs["allow_origins"] = settings.cors_origins_list
    # Allow common tunnel/demo hosts (ngrok, Cloudflare, Vercel) so shared demo URLs work
    cors_kwargs["allow_origin_regex"] = (
        r"https://.*\.(vercel\.app|ngrok-free\.app|ngrok\.io|trycloudflare\.com|lhr\.life)"
    )

app.add_middleware(CORSMiddleware, **cors_kwargs)

app.include_router(api_router, prefix="/api")


def _validate_db_revision_state() -> None:
    alembic_ini_path = Path(__file__).resolve().parents[1] / "alembic.ini"
    config = Config(str(alembic_ini_path))
    script = ScriptDirectory.from_config(config)
    heads = set(script.get_heads())
    with engine.connect() as conn:
        current_revision = MigrationContext.configure(conn).get_current_revision()

    if current_revision in heads:
        logger.info("DB revision check passed: current=%s", current_revision)
        return

    message = (
        f"Database schema is not at Alembic head (current={current_revision}, heads={sorted(heads)}). "
        "Run `alembic upgrade head` before starting the API."
    )
    if settings.environment != "development" or settings.require_db_at_head:
        raise RuntimeError(message)
    logger.warning(message)


@app.on_event("startup")
async def validate_production_settings() -> None:
    manager.set_app_loop(asyncio.get_running_loop())
    if settings.environment != "development":
        if not (settings.jwt_secret_key or "").strip():
            raise RuntimeError("JWT_SECRET_KEY must be set in production. See backend/.env.example")
        if not (settings.super_admin_password or "").strip():
            raise RuntimeError("SUPER_ADMIN_PASSWORD must be set in production. See backend/.env.example")
    _validate_db_revision_state()
    repair_db = SessionLocal()
    try:
        repaired = conversation_service.repair_active_assignment_conversations(repair_db)
        if repaired:
            repair_db.commit()
            logger.info("Repaired %s missing assignment conversation(s) at startup", repaired)
        else:
            repair_db.rollback()
    finally:
        repair_db.close()
    start_chat_session_scheduler()


@app.on_event("shutdown")
async def _stop_background_tasks() -> None:
    stop_chat_session_scheduler()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


def release_db_transaction_if_open(db_session) -> None:
    if db_session.in_transaction():
        db_session.rollback()


@app.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    project_id: int = Query(...),
) -> None:
    db = SessionLocal()
    user: User | None = None
    connected = False

    try:
        payload = decode_access_token(token)
        sub = payload.get("sub")
        if not sub:
            raise TokenPayloadError()

        user = db.scalar(select(User).where(User.id == int(sub), User.is_active.is_(True)))
        if not user:
            raise TokenPayloadError()

        validate_user_session(db, user=user, payload=payload)
        ensure_project_access(db, user, project_id)

        await manager.connect(project_id, user.id, websocket)
        connected = True

        presence = presence_service.set_online(db, project_id=project_id, user_id=user.id)
        if user.role == UserRole.OPERATOR:
            presence_service.record_presence_event(
                db, user_id=user.id, project_id=project_id, event_type=PresenceEventType.ONLINE
            )
        db.commit()
        db.refresh(presence)

        viewers = presence_service.get_presence_viewers(db, project_id=project_id, target_user_id=user.id)
        await manager.broadcast_to_users(
            project_id,
            viewers,
            conversation_service.presence_payload(
                user_id=user.id,
                project_id=project_id,
                is_online=True,
                last_seen_at=presence.last_seen_at,
            ),
        )

        while True:
            incoming = await websocket.receive_json()
            try:
                # Re-validate role-based session policy on every event so older
                # devices are cut off immediately after a new login.
                fresh_user = db.get(User, user.id) if user else None
                if fresh_user is None or not fresh_user.is_active:
                    await websocket.close(code=4401)
                    return
                validate_user_session(db, user=fresh_user, payload=payload)
                ensure_project_access(db, fresh_user, project_id)
                user = fresh_user
                event = incoming.get("event")

                if event == "join":
                    conversation_id = int(incoming.get("conversation_id", 0))
                    conversation = conversation_service.get_conversation_or_404(db, conversation_id)
                    conversation_service.assert_conversation_access(db, conversation=conversation, project_id=project_id, user=user)
                    await websocket.send_json({"event": "join:ok", "data": {"conversation_id": conversation_id}})
                    continue

                if event == "message":
                    conversation_id = int(incoming.get("conversation_id", 0))
                    content = str(incoming.get("content", ""))

                    # Conversation is re-fetched per message for correctness.
                    # Sender is the same user object resolved at connect time; permission checks
                    # still enforce operator/member assignment + project membership strictly.
                    if user is None or not user.is_active:
                        await websocket.close(code=4401)
                        return

                    conversation = conversation_service.get_conversation_or_404(db, conversation_id)

                    logger.info(
                        "ws_message sender_id=%s project_id=%s conversation_id=%s type=%s admin_id=%s operator_id=%s member_id=%s",
                        user.id,
                        project_id,
                        conversation.id,
                        conversation.type,
                        getattr(conversation, "admin_id", None),
                        getattr(conversation, "operator_id", None),
                        getattr(conversation, "member_id", None),
                    )

                    try:
                        message = conversation_service.create_message(
                            db,
                            project_id=project_id,
                            conversation_id=conversation_id,
                            sender=user,
                            content=content,
                            conversation=conversation,
                            message_type=MessageType.TEXT,
                        )
                    except HTTPException as he:
                        db.rollback()
                        await websocket.send_json({"event": "error", "detail": he.detail})
                        continue

                    recipients = conversation_service.get_message_recipients(
                        db,
                        project_id=project_id,
                        conversation_id=conversation_id,
                    )
                    notif_title = f"New message from {user.name}: {content}"
                    notified_users: set[int] = set()
                    other_recipient_ids = {uid for uid in recipients if uid != user.id}
                    recipient_users = {
                        u.id: u for u in db.scalars(
                            select(User).where(User.id.in_(other_recipient_ids))
                        ).all()
                    } if other_recipient_ids else {}
                    for uid, rcpt in recipient_users.items():
                        if rcpt.role == UserRole.ADMIN:
                            continue
                        notified_users.add(uid)
                        notification_service.create_notification(
                            db,
                            project_id=project_id,
                            user_id=uid,
                            kind="new_message",
                            title=notif_title,
                            reference_id=message.conversation_id,
                        )
                    db.commit()
                    db.refresh(message)
                    payload_data = MessageOut.model_validate(message).model_dump(mode="json")
                    await manager.broadcast_to_users(project_id, list(recipients), {"event": "message:new", "data": payload_data})
                    if conversation.type == ConversationType.OPERATOR_MEMBER:
                        chat_session = chat_session_service.get_latest_session(db, conversation_id=conversation_id)
                        db.commit()
                        await broadcast_chat_session_update(db, project_id=project_id, conversation=conversation, session=chat_session)
                    schedule_post_message_broadcasts(
                        project_id=project_id,
                        recipient_ids=recipients,
                        notified_user_ids=notified_users,
                        conversation_id=conversation_id,
                    )
                    continue

                if event == "presence":
                    snapshot = presence_service.get_visible_presence(db, project_id=project_id, viewer=user)
                    data = [
                        {
                            "user_id": item.user_id,
                            "project_id": item.project_id,
                            "is_online": item.is_online,
                            "last_seen_at": item.last_seen_at.isoformat() if item.last_seen_at else None,
                        }
                        for item in snapshot
                    ]
                    await websocket.send_json({"event": "presence:snapshot", "data": data})
                    continue

                if event == "typing_start":
                    conversation_id = int(incoming.get("conversation_id", 0))
                    conversation = conversation_service.get_conversation_or_404(db, conversation_id)
                    conversation_service.assert_conversation_access(db, conversation=conversation, project_id=project_id, user=user)
                    recipients = conversation_service.get_message_recipients(db, project_id=project_id, conversation_id=conversation_id)
                    recipients.discard(user.id)
                    await manager.broadcast_to_users(
                        project_id,
                        list(recipients),
                        {"event": "typing:start", "data": {"conversation_id": conversation_id, "user_id": user.id}},
                    )
                    continue

                if event == "typing_stop":
                    conversation_id = int(incoming.get("conversation_id", 0))
                    conversation = conversation_service.get_conversation_or_404(db, conversation_id)
                    conversation_service.assert_conversation_access(db, conversation=conversation, project_id=project_id, user=user)
                    recipients = conversation_service.get_message_recipients(db, project_id=project_id, conversation_id=conversation_id)
                    recipients.discard(user.id)
                    await manager.broadcast_to_users(
                        project_id,
                        list(recipients),
                        {"event": "typing:stop", "data": {"conversation_id": conversation_id, "user_id": user.id}},
                    )
                    continue

                if event == "read_update":
                    conversation_id = int(incoming.get("conversation_id", 0))
                    message_id = int(incoming.get("message_id", 0))
                    conversation = conversation_service.get_conversation_or_404(db, conversation_id)
                    conversation_service.assert_conversation_access(db, conversation=conversation, project_id=project_id, user=user)
                    conversation_service.mark_message_read(db, message_id=message_id, user_id=user.id, project_id=project_id)
                    db.commit()
                    recipients = conversation_service.get_message_recipients(db, project_id=project_id, conversation_id=conversation_id)
                    await manager.broadcast_to_users(
                        project_id,
                        list(recipients),
                        {"event": "read:update", "data": {"message_id": message_id, "user_id": user.id, "conversation_id": conversation_id}},
                    )
                    await broadcast_notification_counts(db, project_id=project_id, user_ids={user.id})
                    continue

                await websocket.send_json({"event": "error", "detail": "Unsupported event"})
            finally:
                # Every websocket event must release DB transaction state promptly so
                # pooled connections are returned under sustained socket load.
                release_db_transaction_if_open(db)

    except TokenPayloadError:
        logger.warning("ws_close token_payload_error project_id=%s", project_id)
        await websocket.close(code=4401)
    except HTTPException as exc:
        logger.warning(
            "ws_close http_exception project_id=%s user_id=%s status=%s detail=%s",
            project_id,
            user.id if user else None,
            exc.status_code,
            exc.detail,
        )
        if exc.status_code == 401:
            await websocket.close(code=4401)
        elif exc.status_code == 403:
            await websocket.close(code=4403)
        else:
            await websocket.close(code=1011)
    except SATimeoutError:
        logger.exception("ws_close db_pool_timeout project_id=%s user_id=%s", project_id, user.id if user else None)
        if connected:
            await websocket.close(code=1013)
    except WebSocketDisconnect as exc:
        logger.info("ws_disconnected project_id=%s user_id=%s code=%s", project_id, user.id if user else None, getattr(exc, "code", None))
    except Exception as exc:  # pragma: no cover
        logger.exception("ws_error project_id=%s user_id=%s err=%s", project_id, user.id if user else None, exc)
        if connected:
            await websocket.send_json({"event": "error", "detail": str(exc)})
    finally:
        if user and connected:
            await manager.disconnect(project_id, user.id, websocket)
            still_connected = await manager.has_user_connections(project_id=project_id, user_id=user.id)
            if not still_connected:
                project_exists = db.scalar(select(Project.id).where(Project.id == project_id)) is not None
                if not project_exists:
                    # Project may have been deleted while socket was open.
                    db.rollback()
                    logger.info("Skipping set_offline for deleted project_id=%s user_id=%s", project_id, user.id)
                else:
                    try:
                        presence = presence_service.set_offline(db, project_id=project_id, user_id=user.id)
                        if user.role == UserRole.OPERATOR:
                            presence_service.record_presence_event(
                                db, user_id=user.id, project_id=project_id, event_type=PresenceEventType.OFFLINE
                            )
                        db.commit()
                        db.refresh(presence)

                        viewers = presence_service.get_presence_viewers(db, project_id=project_id, target_user_id=user.id)
                        await manager.broadcast_to_users(
                            project_id,
                            viewers,
                            conversation_service.presence_payload(
                                user_id=user.id,
                                project_id=project_id,
                                is_online=False,
                                last_seen_at=presence.last_seen_at,
                            ),
                        )

                        if user.role == UserRole.MEMBER:
                            abandoned = chat_session_service.abandon_active_sessions_for_member(
                                db, project_id=project_id, member_id=user.id,
                            )
                            db.commit()
                            for abandoned_session in abandoned:
                                abandoned_conv = db.get(Conversation, abandoned_session.conversation_id)
                                if abandoned_conv is not None:
                                    await broadcast_chat_session_update(
                                        db, project_id=project_id, conversation=abandoned_conv, session=abandoned_session,
                                    )
                    except IntegrityError:
                        db.rollback()
                        logger.warning(
                            "Skipping set_offline due to project/presence FK race project_id=%s user_id=%s",
                            project_id,
                            user.id,
                        )

        db.close()
