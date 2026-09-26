from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.enums import ChatSessionStatus


class ChatSession(Base):
    __tablename__ = "chat_sessions"
    __table_args__ = (
        # Sweep query: find ACTIVE sessions whose deadline has passed.
        Index("ix_chat_sessions_status_expires", "status", "expires_at"),
        Index("ix_chat_sessions_status_sla_deadline", "status", "first_response_sla_deadline"),
        Index("ix_chat_sessions_conversation_status", "conversation_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    operator_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    member_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    status: Mapped[ChatSessionStatus] = mapped_column(
        Enum(ChatSessionStatus, name="chat_session_status", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        default=ChatSessionStatus.ACTIVE,
    )

    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    first_response_sla_deadline: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    first_response_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_response_sla_met: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    thank_you_present: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
