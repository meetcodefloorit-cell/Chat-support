"""add chat_sessions, chat_session_events, operator_mistakes tables (chat timing/SLA system)

Revision ID: f7c1e2a9b3d6
Revises: d4e5f6a7b8c9
Create Date: 2026-09-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f7c1e2a9b3d6"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


chat_session_status = sa.Enum(
    "active", "completed", "auto_closed", "abandoned", name="chat_session_status"
)
operator_mistake_type = sa.Enum(
    "first_response_sla_breach", "missing_thank_you", name="operator_mistake_type"
)
chat_session_event_type = sa.Enum(
    "session_started",
    "operator_first_response",
    "first_response_sla_met",
    "first_response_sla_breached",
    "customer_abandoned",
    "close_attempt_blocked",
    "thank_you_validated",
    "thank_you_missing",
    "chat_auto_closed",
    "chat_completed",
    name="chat_session_event_type",
)


def upgrade() -> None:
    op.create_table(
        "chat_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("member_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("status", chat_session_status, nullable=False, server_default="active"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("first_response_sla_deadline", sa.DateTime(timezone=True), nullable=False),
        sa.Column("first_response_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("first_response_sla_met", sa.Boolean(), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("thank_you_present", sa.Boolean(), nullable=True),
    )
    op.create_index("ix_chat_sessions_status_expires", "chat_sessions", ["status", "expires_at"])
    op.create_index("ix_chat_sessions_status_sla_deadline", "chat_sessions", ["status", "first_response_sla_deadline"])
    op.create_index("ix_chat_sessions_conversation_status", "chat_sessions", ["conversation_id", "status"])

    op.create_table(
        "operator_mistakes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("mistake_type", operator_mistake_type, nullable=False, index=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("reason", sa.String(length=255), nullable=True),
    )

    op.create_table(
        "chat_session_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("event_type", chat_session_event_type, nullable=False, index=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("detail", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("chat_session_events")
    op.drop_table("operator_mistakes")
    op.drop_index("ix_chat_sessions_conversation_status", table_name="chat_sessions")
    op.drop_index("ix_chat_sessions_status_sla_deadline", table_name="chat_sessions")
    op.drop_index("ix_chat_sessions_status_expires", table_name="chat_sessions")
    op.drop_table("chat_sessions")

    bind = op.get_bind()
    chat_session_event_type.drop(bind, checkfirst=True)
    operator_mistake_type.drop(bind, checkfirst=True)
    chat_session_status.drop(bind, checkfirst=True)
