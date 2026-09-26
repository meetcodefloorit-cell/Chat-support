"""add project support fields and hidden conversations

Revision ID: c3f9a1b2d4e5
Revises: 9b8d7c6a5e4f
Create Date: 2026-03-25
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c3f9a1b2d4e5"
down_revision: Union[str, None] = "9b8d7c6a5e4f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("support_email", sa.String(length=255), nullable=True))
    op.add_column("projects", sa.Column("support_phone", sa.String(length=32), nullable=True))

    op.create_table(
        "conversation_hidden",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("hidden_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("conversation_id", "user_id", name="uq_conversation_hidden_conversation_user"),
    )
    op.create_index("ix_conversation_hidden_conversation_id", "conversation_hidden", ["conversation_id"])
    op.create_index("ix_conversation_hidden_user_id", "conversation_hidden", ["user_id"])
    op.create_index("ix_conversation_hidden_project_id", "conversation_hidden", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_conversation_hidden_project_id", table_name="conversation_hidden")
    op.drop_index("ix_conversation_hidden_user_id", table_name="conversation_hidden")
    op.drop_index("ix_conversation_hidden_conversation_id", table_name="conversation_hidden")
    op.drop_table("conversation_hidden")

    op.drop_column("projects", "support_phone")
    op.drop_column("projects", "support_email")
