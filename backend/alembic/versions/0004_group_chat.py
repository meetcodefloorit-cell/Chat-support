"""group chat support

Revision ID: 0004_group_chat
Revises: 0003_attachments_reads
Create Date: 2026-03-13

"""
from alembic import op
import sqlalchemy as sa


revision = "0004_group_chat"
down_revision = "0003_attachments_reads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    # PostgreSQL: ALTER TYPE ADD VALUE must be committed before the new value can be used.
    # Run in autocommit block so it commits immediately.
    if bind.dialect.name == "postgresql":
        with op.get_context().autocommit_block():
            op.execute("""
                DO $$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid
                        WHERE t.typname = 'conversation_type' AND e.enumlabel = 'group') THEN
                        ALTER TYPE conversation_type ADD VALUE 'group';
                    END IF;
                END $$;
            """)

    op.add_column("conversations", sa.Column("name", sa.String(length=255), nullable=True, server_default=""))
    op.execute("UPDATE conversations SET name = '' WHERE name IS NULL")
    op.alter_column("conversations", "name", existing_type=sa.String(255), nullable=False)

    # Update unique constraint to include name (for group chat uniqueness)
    op.drop_constraint("uq_conversation_identity", "conversations", type_="unique")
    op.create_unique_constraint(
        "uq_conversation_identity",
        "conversations",
        ["project_id", "type", "name", "operator_id", "member_id", "admin_id"],
    )

    # Partial unique index for group names per project
    if bind.dialect.name == "postgresql":
        op.execute("CREATE UNIQUE INDEX uq_conversation_group_name ON conversations (project_id, name) WHERE type = 'group' AND name != ''")

    op.create_table(
        "conversation_participants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("conversation_id", sa.Integer(), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("conversation_id", "user_id", name="uq_conv_participant"),
    )
    op.create_index("ix_conversation_participants_conversation_id", "conversation_participants", ["conversation_id"])
    op.create_index("ix_conversation_participants_user_id", "conversation_participants", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP INDEX IF EXISTS uq_conversation_group_name")
    op.drop_index("ix_conversation_participants_user_id", table_name="conversation_participants")
    op.drop_index("ix_conversation_participants_conversation_id", table_name="conversation_participants")
    op.drop_table("conversation_participants")
    op.drop_column("conversations", "name")
    # Note: PostgreSQL does not support removing enum values easily; leave 'group' in enum
