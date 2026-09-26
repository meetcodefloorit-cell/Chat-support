"""add operator_presence_history table (server-authoritative online/offline audit trail)

Revision ID: a1b2c3d4e5f6
Revises: f7c1e2a9b3d6
Create Date: 2026-09-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "f7c1e2a9b3d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


presence_event_type = sa.Enum("online", "offline", name="presence_event_type")


def upgrade() -> None:
    op.create_table(
        "operator_presence_history",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("event_type", presence_event_type, nullable=False, index=True),
        sa.Column("occurred_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_presence_history_user_project_occurred",
        "operator_presence_history",
        ["user_id", "project_id", "occurred_at"],
    )
    op.create_index(
        "ix_presence_history_project_occurred",
        "operator_presence_history",
        ["project_id", "occurred_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_presence_history_project_occurred", table_name="operator_presence_history")
    op.drop_index("ix_presence_history_user_project_occurred", table_name="operator_presence_history")
    op.drop_table("operator_presence_history")

    bind = op.get_bind()
    presence_event_type.drop(bind, checkfirst=True)
