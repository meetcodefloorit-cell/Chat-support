from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.realtime import broadcast_chat_session_update
from app.core.deps import ensure_project_access, get_current_user
from app.db.session import get_db
from app.services import chat_session_service, conversation_service
from app.models import User, UserRole

router = APIRouter(tags=["chat_sessions"])


@router.get("/projects/{project_id}/conversations/{conversation_id}/session")
def get_session_state(
    project_id: int,
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Server-authoritative current session state for this conversation. Frontend timers
    must be computed from this response, not from local clocks/state."""
    ensure_project_access(db, current_user, project_id)
    conversation = conversation_service.get_conversation_or_404(db, conversation_id)
    conversation_service.assert_conversation_access(db, conversation=conversation, project_id=project_id, user=current_user)

    session = chat_session_service.get_latest_session(db, conversation_id=conversation_id)
    db.commit()
    payload = chat_session_service.serialize_session(session)
    payload["conversation_id"] = conversation_id
    return payload


@router.post("/projects/{project_id}/conversations/{conversation_id}/session/close")
async def close_session(
    project_id: int,
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Operator-only manual close. Rejects with 422 if the required thank-you message is
    missing -- the caller should show the warning and let the operator send it, then retry."""
    if current_user.role not in (UserRole.OPERATOR, UserRole.ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the assigned operator or an admin can close a chat session")
    ensure_project_access(db, current_user, project_id)
    conversation = conversation_service.get_conversation_or_404(db, conversation_id)
    conversation_service.assert_conversation_access(db, conversation=conversation, project_id=project_id, user=current_user)
    if current_user.role == UserRole.OPERATOR and conversation.operator_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator mismatch")

    session = chat_session_service.close_session_manual(
        db, conversation=conversation, now=chat_session_service.now_utc()
    )
    db.commit()

    await broadcast_chat_session_update(db, project_id=project_id, conversation=conversation, session=session)

    payload = chat_session_service.serialize_session(session)
    payload["conversation_id"] = conversation_id
    return payload
