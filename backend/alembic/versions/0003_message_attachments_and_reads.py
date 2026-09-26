"""message attachments and read status

Revision ID: 0003_attachments_reads
Revises: 0002_add_user_uid
Create Date: 2026-03-13

"""
from alembic import op
import sqlalchemy as sa


revision = "0003_attachments_reads"
down_revision = "0002_add_user_uid"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("attachment_url", sa.String(length=512), nullable=True))
    op.add_column("messages", sa.Column("attachment_filename", sa.String(length=255), nullable=True))
    op.add_column("messages", sa.Column("attachment_mime", sa.String(length=64), nullable=True))

    op.create_table(
        "message_reads",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("message_id", "user_id", name="uq_message_read"),
    )
    op.create_index("ix_message_reads_message_id", "message_reads", ["message_id"])
    op.create_index("ix_message_reads_user_id", "message_reads", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_message_reads_user_id", table_name="message_reads")
    op.drop_index("ix_message_reads_message_id", table_name="message_reads")
    op.drop_table("message_reads")
    op.drop_column("messages", "attachment_mime")
    op.drop_column("messages", "attachment_filename")
    op.drop_column("messages", "attachment_url")
