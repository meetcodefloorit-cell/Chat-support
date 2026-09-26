from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.enums import PresenceEventType


class OperatorPresenceHistory(Base):
    """Append-only, server-timestamped audit trail of operator online/offline transitions.

    Written only for OPERATOR-role users from the same websocket connect/disconnect hooks
    that already drive the live `Presence` row (see presence_service.set_online/set_offline
    call sites in main.py) -- never from a client-supplied timestamp or status. Consecutive
    duplicate events for the same (user, project) are deduped at write time so ONLINE/OFFLINE
    rows always alternate, which keeps session reconstruction (pairing an ONLINE row with the
    next OFFLINE row) trivial and correct.
    """

    __tablename__ = "operator_presence_history"
    __table_args__ = (
        Index("ix_presence_history_user_project_occurred", "user_id", "project_id", "occurred_at"),
        Index("ix_presence_history_project_occurred", "project_id", "occurred_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    event_type: Mapped[PresenceEventType] = mapped_column(
        Enum(PresenceEventType, name="presence_event_type", values_callable=lambda x: [e.value for e in x]),
        nullable=False,
        index=True,
    )
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
