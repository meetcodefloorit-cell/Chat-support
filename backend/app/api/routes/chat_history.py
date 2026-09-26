from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.deps import ensure_project_access, get_current_user, require_admin
from app.db.session import get_db
from app.models import ChatSessionStatus, User
from app.schemas.chat_history import ChatHistoryPage, ChatHistoryRow, ChatSessionDetailOut
from app.schemas.message import MessageOut
from app.services import analytics_service, chat_session_service

router = APIRouter(prefix="/chat-history", tags=["chat_history"])


def _parse_status(raw: str | None) -> ChatSessionStatus | None:
    if not raw:
        return None
    try:
        return ChatSessionStatus(raw)
    except ValueError:
        valid = ", ".join(s.value for s in ChatSessionStatus)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"status must be one of: {valid}")


@router.get("", response_model=ChatHistoryPage)
def list_chat_history(
    project_id: int | None = Query(default=None),
    operator_id: int | None = Query(default=None),
    member_id: int | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    search: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatHistoryPage:
    """Admin/Super Admin only -- paginated chat-session report. Every row comes straight
    from the server-authoritative ChatSession table, never hardcoded."""
    require_admin(current_user)
    if project_id is not None:
        ensure_project_access(db, current_user, project_id)

    parsed_status = _parse_status(status_filter)
    rng = analytics_service.normalize_range(start_date, end_date, None)

    items, total = chat_session_service.list_chat_sessions(
        db,
        project_id=project_id,
        operator_id=operator_id,
        member_id=member_id,
        status_filter=parsed_status,
        start=rng.start,
        end=rng.end,
        search=search,
        limit=limit,
        offset=offset,
    )
    return ChatHistoryPage(items=[ChatHistoryRow(**row) for row in items], total=total, limit=limit, offset=offset)


@router.get("/{session_id}", response_model=ChatSessionDetailOut)
def get_chat_history_detail(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatSessionDetailOut:
    """Admin/Super Admin only -- full conversation + timing-event detail for one chat session."""
    require_admin(current_user)
    detail = chat_session_service.get_chat_session_detail(db, session_id=session_id)
    if detail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat session not found")

    ensure_project_access(db, current_user, detail["project_id"])

    messages = detail.pop("messages")
    return ChatSessionDetailOut(
        **detail,
        messages=[MessageOut.model_validate(m) for m in messages],
    )
