import asyncio
import logging

from app.core.websocket_manager import manager
from app.db.session import SessionLocal
from app.services import conversation_service, notification_service

logger = logging.getLogger(__name__)


def _dedupe_targets(user_ids: set[int] | list[int]) -> list[int]:
    return list(dict.fromkeys(user_ids))


def broadcast_event_sync(
    *,
    project_id: int,
    user_ids: set[int] | list[int],
    event: str,
    data: dict,
) -> None:
    targets = _dedupe_targets(user_ids)
    if not targets:
        return

    manager.dispatch_broadcast_to_users(
        project_id,
        targets,
        {"event": event, "data": data},
    )


def broadcast_project_refresh_sync(
    *,
    project_id: int,
    user_ids: set[int] | list[int],
    reason: str = "project_data_changed",
) -> None:
    broadcast_event_sync(
        project_id=project_id,
        user_ids=user_ids,
        event="project:refresh",
        data={"reason": reason},
    )


def broadcast_members_changed_sync(
    *,
    project_id: int,
    user_ids: set[int] | list[int],
    reason: str,
) -> None:
    broadcast_event_sync(
        project_id=project_id,
        user_ids=user_ids,
        event="members:changed",
        data={"reason": reason},
    )


def broadcast_operators_changed_sync(
    *,
    project_id: int,
    user_ids: set[int] | list[int],
    reason: str,
) -> None:
    broadcast_event_sync(
        project_id=project_id,
        user_ids=user_ids,
        event="operators:changed",
        data={"reason": reason},
    )


def broadcast_conversation_remove_sync(
    *,
    project_id: int,
    user_ids: set[int] | list[int],
    conversation_id: int,
    reason: str,
) -> None:
    broadcast_event_sync(
        project_id=project_id,
        user_ids=user_ids,
        event="conversation:remove",
        data={"conversation_id": conversation_id, "reason": reason},
    )


async def broadcast_notification_counts(db, *, project_id: int, user_ids: set[int] | list[int]) -> None:
    counts = notification_service.count_unread_bulk(db, project_id=project_id, user_ids=user_ids)
    if not counts:
        return
    await asyncio.gather(
        *(
            manager.broadcast_to_users(
                project_id,
                [user_id],
                {"event": "notification:count", "data": {"count": count}},
            )
            for user_id, count in counts.items()
        )
    )


async def broadcast_conversation_upserts(
    db,
    *,
    project_id: int,
    user_ids: set[int] | list[int],
    conversation_ids: set[int] | list[int],
) -> None:
    targets = _dedupe_targets(user_ids)
    conversation_targets = _dedupe_targets(conversation_ids)
    if not targets or not conversation_targets:
        return

    users = {
        user.id: user
        for user in db.scalars(
            conversation_service.select_active_users_by_ids(targets)
        ).all()
    }

    tasks = []
    for user_id in targets:
        user = users.get(user_id)
        if not user:
            continue
        for conversation_id in conversation_targets:
            payload = conversation_service.serialize_conversation_for_user(
                db,
                project_id=project_id,
                user=user,
                conversation_id=conversation_id,
            )
            if payload is None:
                tasks.append(
                    manager.send_to_user(
                        project_id,
                        user_id,
                        {
                            "event": "conversation:remove",
                            "data": {"conversation_id": conversation_id, "reason": "not_visible"},
                        },
                    )
                )
                continue
            tasks.append(
                manager.send_to_user(
                    project_id,
                    user_id,
                    {"event": "conversation:upsert", "data": payload.model_dump(mode="json")},
                )
            )
    if tasks:
        await asyncio.gather(*tasks)


async def _background_post_message_broadcasts(
    *,
    project_id: int,
    recipient_ids: set[int],
    notified_user_ids: set[int],
    conversation_id: int,
) -> None:
    """Run conversation upserts and notification counts in a dedicated DB session
    so the caller's WS handler is not blocked."""
    bg_db = SessionLocal()
    try:
        await broadcast_conversation_upserts(
            bg_db,
            project_id=project_id,
            user_ids=recipient_ids,
            conversation_ids={conversation_id},
        )
        if notified_user_ids:
            await broadcast_notification_counts(
                bg_db, project_id=project_id, user_ids=notified_user_ids,
            )
    except Exception:
        logger.exception(
            "background broadcast failed project_id=%s conversation_id=%s",
            project_id, conversation_id,
        )
    finally:
        bg_db.close()


async def broadcast_chat_session_update(db, *, project_id: int, conversation, session) -> None:
    """Push server-authoritative session/timer state to the operator and member so both
    UIs stay in sync without polling. `session` may be None (no session yet)."""
    from app.services import chat_session_service

    payload = chat_session_service.serialize_session(session)
    payload["conversation_id"] = conversation.id
    recipients = [conversation.operator_id]
    if conversation.member_id is not None:
        recipients.append(conversation.member_id)
    await manager.broadcast_to_users(project_id, recipients, {"event": "chat_session:update", "data": payload})


def schedule_post_message_broadcasts(
    *,
    project_id: int,
    recipient_ids: set[int],
    notified_user_ids: set[int],
    conversation_id: int,
) -> None:
    """Fire-and-forget: schedule broadcast tasks without blocking the WS handler."""
    asyncio.get_running_loop().create_task(
        _background_post_message_broadcasts(
            project_id=project_id,
            recipient_ids=recipient_ids,
            notified_user_ids=notified_user_ids,
            conversation_id=conversation_id,
        )
    )
