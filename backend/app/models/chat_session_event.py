from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.enums import ChatSessionEventType


class ChatSessionEvent(Base):
    """Append-only audit trail for chat-session timing events (section 23 of the spec)."""

    __tablename__ = "chat_session_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type: Mapped[ChatSessionEventType] = mapped_column(
        Enum(ChatSessionEventType, name="chat_session_event_type", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True,
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
