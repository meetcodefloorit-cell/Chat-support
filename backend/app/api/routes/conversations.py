import os
import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from typing import Optional
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.realtime import broadcast_chat_session_update, broadcast_conversation_upserts, broadcast_notification_counts
from app.core.deps import ensure_project_access, get_current_user, require_admin
from app.core.paths import UPLOADS_DIR
from app.core.websocket_manager import manager
from app.db.session import get_db
from app.models import ConversationType, MessageType, User, UserRole
from app.schemas import ConversationOut, GroupCreate, MessageCreate, MessageOut
from app.services import chat_session_service, conversation_service, notification_service

router = APIRouter(tags=["conversations"])

UPLOAD_DIR = UPLOADS_DIR
os.makedirs(UPLOAD_DIR, exist_ok=True)
MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_ATTACHMENT_EXT = {".pdf", ".doc", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip"}
ALLOWED_ATTACHMENT_MIME = {
    "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain", "image/png", "image/jpeg", "image/gif", "image/webp", "application/zip",
}


@router.get("/projects/{project_id}/conversations", response_model=list[ConversationOut])
def list_conversations(
    project_id: int,
    operator_id: Optional[int] = Query(default=None, description="Filter by operator (admin only)"),
    member_id: Optional[int] = Query(default=None, description="Filter by member (admin only)"),
    type: Optional[str] = Query(default=None, description="Filter by conversation type: admin_operator, operator_member, group (admin only)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ConversationOut]:
    ensure_project_access(db, current_user, project_id)
    conversations = conversation_service.list_conversations(
        db,
        project_id=project_id,
        user=current_user,
        operator_id=operator_id,
        member_id=member_id,
        conversation_type=type,
    )
    stats_by_conversation = conversation_service.get_conversation_stats(
        db,
        project_id=project_id,
        user_id=current_user.id,
        conversations=conversations,
    )
    result = []
    for conv in conversations:
        data = ConversationOut.model_validate(conv).model_dump()
        stats = stats_by_conversation.get(conv.id, {})
        data["unread_count"] = int(stats.get("unread_count", 0) or 0)
        data["last_message_at"] = stats.get("last_message_at")
        result.append(ConversationOut(**data))
    return result


@router.get("/projects/{project_id}/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def list_messages(
    project_id: int,
    conversation_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MessageOut]:
    ensure_project_access(db, current_user, project_id)
    messages = conversation_service.list_messages(
        db,
        project_id=project_id,
        conversation_id=conversation_id,
        user=current_user,
        limit=limit,
        offset=offset,
    )
    msg_ids = [m.id for m in messages]
    read_by = conversation_service.get_message_read_by(db, msg_ids)
    result = []
    for m in messages:
        data = MessageOut.model_validate(m).model_dump()
        data["read_by_user_ids"] = read_by.get(m.id, [])
        result.append(MessageOut(**data))
    return result


@router.post("/projects/{project_id}/conversations/{conversation_id}/messages", response_model=MessageOut)
async def post_message(
    project_id: int,
    conversation_id: int,
    payload: MessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageOut:
    ensure_project_access(db, current_user, project_id)
    message = conversation_service.create_message(
        db,
        project_id=project_id,
        conversation_id=conversation_id,
        sender=current_user,
        content=payload.content,
        message_type=MessageType.TEXT,
    )
    recipients = conversation_service.get_message_recipients(
        db, project_id=project_id, conversation_id=conversation_id,
    )
    notif_title = f"New message from {current_user.name}: {payload.content}"
    notified_users: set[int] = set()
    for uid in recipients:
        if uid == current_user.id:
            continue
        rcpt = db.get(User, uid)
        if rcpt and rcpt.role == UserRole.ADMIN:
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
    await manager.broadcast_to_users(
        project_id, list(recipients), {"event": "message:new", "data": payload_data}
    )
    await broadcast_conversation_upserts(
        db,
        project_id=project_id,
        user_ids=recipients,
        conversation_ids={conversation_id},
    )
    conversation = conversation_service.get_conversation_or_404(db, conversation_id)
    if conversation.type == ConversationType.OPERATOR_MEMBER:
        session = chat_session_service.get_latest_session(db, conversation_id=conversation_id)
        db.commit()
        await broadcast_chat_session_update(db, project_id=project_id, conversation=conversation, session=session)
    if notified_users:
        await broadcast_notification_counts(db, project_id=project_id, user_ids=notified_users)

    return MessageOut.model_validate(message)


@router.post("/projects/{project_id}/conversations/{conversation_id}/attachments", response_model=MessageOut)
async def upload_attachment(
    project_id: int,
    conversation_id: int,
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageOut:
    ensure_project_access(db, current_user, project_id)
    conv = conversation_service.get_conversation_or_404(db, conversation_id)
    conversation_service.assert_conversation_access(db, conversation=conv, project_id=project_id, user=current_user)

    ext = os.path.splitext(file.filename or "file.bin")[1].lower()
    if ext not in ALLOWED_ATTACHMENT_EXT:
        raise HTTPException(status_code=400, detail="Unsupported file type")
    ct = file.content_type or ""
    if ct and ct not in ALLOWED_ATTACHMENT_MIME:
        raise HTTPException(status_code=400, detail=f"Unsupported MIME type: {file.content_type}")

    contents = file.file.read(MAX_ATTACHMENT_SIZE + 1)
    if len(contents) > MAX_ATTACHMENT_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Maximum size is 10 MB.")

    safe_name = f"att_{conversation_id}_{uuid.uuid4().hex[:12]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, safe_name)
    with open(filepath, "wb") as f:
        f.write(contents)

    attachment_url = f"/projects/{project_id}/attachments/{safe_name}"
    raw_name = (os.path.basename(file.filename or "Attachment").strip() or "Attachment")[:200]
    safe_display_name = re.sub(r'[<>&"\']', "", raw_name).strip() or "Attachment"
    message = conversation_service.create_message(
        db,
        project_id=project_id,
        conversation_id=conversation_id,
        sender=current_user,
        content=safe_display_name,
        message_type=MessageType.TEXT,
        attachment_url=attachment_url,
        attachment_filename=safe_display_name,
        attachment_mime=file.content_type,
    )
    recipients = conversation_service.get_message_recipients(db, project_id=project_id, conversation_id=conversation_id)
    att_title = f"New attachment from {current_user.name}: {safe_display_name}"
    notified_users: set[int] = set()
    for uid in recipients:
        if uid == current_user.id:
            continue
        rcpt = db.get(User, uid)
        if rcpt and rcpt.role == UserRole.ADMIN:
            continue
        notified_users.add(uid)
        notification_service.create_notification(
            db,
            project_id=project_id,
            user_id=uid,
            kind="new_message",
            title=att_title,
            reference_id=message.conversation_id,
        )
    db.commit()
    db.refresh(message)

    payload_data = MessageOut.model_validate(message).model_dump(mode="json")
    await manager.broadcast_to_users(project_id, list(recipients), {"event": "message:new", "data": payload_data})
    await broadcast_conversation_upserts(
        db,
        project_id=project_id,
        user_ids=recipients,
        conversation_ids={conversation_id},
    )
    conversation = conversation_service.get_conversation_or_404(db, conversation_id)
    if conversation.type == ConversationType.OPERATOR_MEMBER:
        session = chat_session_service.get_latest_session(db, conversation_id=conversation_id)
        db.commit()
        await broadcast_chat_session_update(db, project_id=project_id, conversation=conversation, session=session)
    if notified_users:
        await broadcast_notification_counts(db, project_id=project_id, user_ids=notified_users)

    return MessageOut.model_validate(message)


@router.get("/projects/{project_id}/attachments/{filename}")
def get_attachment(
    project_id: int,
    filename: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Serve attachment with permission check. User must have access to the conversation."""
    ensure_project_access(db, current_user, project_id)
    match = re.match(r"^att_(\d+)_[a-f0-9]{12}\.[a-z0-9]+$", filename)
    if not match:
        raise HTTPException(status_code=404, detail="Invalid attachment filename")
    conversation_id = int(match.group(1))
    conv = conversation_service.get_conversation_or_404(db, conversation_id)
    conversation_service.assert_conversation_access(db, conversation=conv, project_id=project_id, user=current_user)
    filepath = os.path.join(UPLOAD_DIR, filename)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Attachment not found")
    return FileResponse(filepath, filename=filename)


@router.get("/projects/{project_id}/messages/search", response_model=list[MessageOut])
def search_messages(
    project_id: int,
    q: str = Query(..., min_length=1),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[MessageOut]:
    ensure_project_access(db, current_user, project_id)
    messages = conversation_service.search_messages(db, project_id=project_id, user=current_user, query=q, limit=limit)
    msg_ids = [m.id for m in messages]
    read_by = conversation_service.get_message_read_by(db, msg_ids)
    return [
        MessageOut(**{**MessageOut.model_validate(m).model_dump(), "read_by_user_ids": read_by.get(m.id, [])})
        for m in messages
    ]


@router.post("/projects/{project_id}/conversations/group", response_model=ConversationOut)
def create_group(
    project_id: int,
    payload: GroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ConversationOut:
    # Group chat is intentionally disabled in the current delivery scope.
    raise HTTPException(status_code=404, detail="Group chat is not enabled in this deployment")
