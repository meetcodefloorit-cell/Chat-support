"""Initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-03-05 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    user_role_enum = sa.Enum("ADMIN", "OPERATOR", "MEMBER", name="user_role")
    membership_status_enum = sa.Enum("active", "removed", name="membership_status")
    conversation_type_enum = sa.Enum("admin_operator", "operator_member", name="conversation_type")
    message_type_enum = sa.Enum("text", "admin_broadcast", name="message_type")

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("uid", sa.String(length=16), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", user_role_enum, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_users_uid", "users", ["uid"], unique=True)
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "projects",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("logo_url", sa.String(length=512), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "project_users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_override", user_role_enum, nullable=True),
        sa.Column("status", membership_status_enum, nullable=False, server_default="active"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "user_id", name="uq_project_user"),
    )
    op.create_index("ix_project_users_project_id", "project_users", ["project_id"])
    op.create_index("ix_project_users_user_id", "project_users", ["user_id"])

    op.create_table(
        "operator_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("admin_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "operator_id", name="uq_project_operator"),
    )
    op.create_index("ix_operator_assignments_project_id", "operator_assignments", ["project_id"])
    op.create_index("ix_operator_assignments_admin_id", "operator_assignments", ["admin_id"])
    op.create_index("ix_operator_assignments_operator_id", "operator_assignments", ["operator_id"])

    op.create_table(
        "member_assignments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("member_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("project_id", "member_id", name="uq_project_member"),
    )
    op.create_index("ix_member_assignments_project_id", "member_assignments", ["project_id"])
    op.create_index("ix_member_assignments_operator_id", "member_assignments", ["operator_id"])
    op.create_index("ix_member_assignments_member_id", "member_assignments", ["member_id"])

    op.create_table(
        "conversations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", conversation_type_enum, nullable=False),
        sa.Column("operator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("member_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("admin_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "project_id",
            "type",
            "operator_id",
            "member_id",
            "admin_id",
            name="uq_conversation_identity",
        ),
    )
    op.create_index("ix_conversations_project_id", "conversations", ["project_id"])
    op.create_index("ix_conversations_operator_id", "conversations", ["operator_id"])
    op.create_index("ix_conversations_member_id", "conversations", ["member_id"])
    op.create_index("ix_conversations_admin_id", "conversations", ["admin_id"])

    op.create_table(
        "messages",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_role", user_role_enum, nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("message_type", message_type_enum, nullable=False, server_default="text"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_messages_conversation_id", "messages", ["conversation_id"])
    op.create_index("ix_messages_project_id", "messages", ["project_id"])
    op.create_index("ix_messages_sender_user_id", "messages", ["sender_user_id"])

    op.create_table(
        "presence",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("is_online", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "project_id", name="uq_presence_user_project"),
    )
    op.create_index("ix_presence_user_id", "presence", ["user_id"])
    op.create_index("ix_presence_project_id", "presence", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_presence_project_id", table_name="presence")
    op.drop_index("ix_presence_user_id", table_name="presence")
    op.drop_table("presence")

    op.drop_index("ix_messages_sender_user_id", table_name="messages")
    op.drop_index("ix_messages_project_id", table_name="messages")
    op.drop_index("ix_messages_conversation_id", table_name="messages")
    op.drop_table("messages")

    op.drop_index("ix_conversations_admin_id", table_name="conversations")
    op.drop_index("ix_conversations_member_id", table_name="conversations")
    op.drop_index("ix_conversations_operator_id", table_name="conversations")
    op.drop_index("ix_conversations_project_id", table_name="conversations")
    op.drop_table("conversations")

    op.drop_index("ix_member_assignments_member_id", table_name="member_assignments")
    op.drop_index("ix_member_assignments_operator_id", table_name="member_assignments")
    op.drop_index("ix_member_assignments_project_id", table_name="member_assignments")
    op.drop_table("member_assignments")

    op.drop_index("ix_operator_assignments_operator_id", table_name="operator_assignments")
    op.drop_index("ix_operator_assignments_admin_id", table_name="operator_assignments")
    op.drop_index("ix_operator_assignments_project_id", table_name="operator_assignments")
    op.drop_table("operator_assignments")

    op.drop_index("ix_project_users_user_id", table_name="project_users")
    op.drop_index("ix_project_users_project_id", table_name="project_users")
    op.drop_table("project_users")

    op.drop_table("projects")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")

    bind = op.get_bind()
    sa.Enum(name="message_type").drop(bind, checkfirst=True)
    sa.Enum(name="conversation_type").drop(bind, checkfirst=True)
    sa.Enum(name="membership_status").drop(bind, checkfirst=True)
    sa.Enum(name="user_role").drop(bind, checkfirst=True)
