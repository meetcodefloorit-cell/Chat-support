"""add realtime hot path indexes

Revision ID: d4e5f6a7b8c9
Revises: b8f7c2d1e9a4
Create Date: 2026-04-08 13:20:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "b8f7c2d1e9a4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_messages_project_conversation_created_at",
        "messages",
        ["project_id", "conversation_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_message_reads_message_user",
        "message_reads",
        ["message_id", "user_id"],
        unique=False,
    )
    op.create_index(
        "ix_notifications_project_user_read_created",
        "notifications",
        ["project_id", "user_id", "read_at", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_conversation_hidden_project_user_conversation_hidden_at",
        "conversation_hidden",
        ["project_id", "user_id", "conversation_id", "hidden_at"],
        unique=False,
    )
    op.create_index(
        "ix_project_users_project_user_status",
        "project_users",
        ["project_id", "user_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_member_assignments_project_member_active",
        "member_assignments",
        ["project_id", "member_id", "is_active"],
        unique=False,
    )
    op.create_index(
        "ix_operator_assignments_project_operator_active",
        "operator_assignments",
        ["project_id", "operator_id", "is_active"],
        unique=False,
    )
    op.create_index(
        "ix_conversations_project_type_operator_member_admin_created",
        "conversations",
        ["project_id", "type", "operator_id", "member_id", "admin_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_conversations_project_type_operator_member_admin_created", table_name="conversations")
    op.drop_index("ix_operator_assignments_project_operator_active", table_name="operator_assignments")
    op.drop_index("ix_member_assignments_project_member_active", table_name="member_assignments")
    op.drop_index("ix_project_users_project_user_status", table_name="project_users")
    op.drop_index(
        "ix_conversation_hidden_project_user_conversation_hidden_at",
        table_name="conversation_hidden",
    )
    op.drop_index("ix_notifications_project_user_read_created", table_name="notifications")
    op.drop_index("ix_message_reads_message_user", table_name="message_reads")
    op.drop_index("ix_messages_project_conversation_created_at", table_name="messages")
