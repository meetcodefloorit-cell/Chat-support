"""add user uid (idempotent)

Revision ID: 0002_add_user_uid
Revises: 0001_initial
Create Date: 2026-03-10
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect as sa_inspect


revision = "0002_add_user_uid"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    columns = [col["name"] for col in inspector.get_columns("users")]

    if "uid" not in columns:
        op.add_column("users", sa.Column("uid", sa.String(length=16), nullable=True))
        op.execute("UPDATE users SET uid = substr(md5(random()::text), 1, 8) WHERE uid IS NULL")
        op.alter_column("users", "uid", existing_type=sa.String(length=16), nullable=False)

    indexes = [idx["name"] for idx in inspector.get_indexes("users")]
    if "ix_users_uid" not in indexes:
        op.create_index("ix_users_uid", "users", ["uid"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa_inspect(bind)
    indexes = [idx["name"] for idx in inspector.get_indexes("users")]
    if "ix_users_uid" in indexes:
        op.drop_index("ix_users_uid", table_name="users")
    columns = [col["name"] for col in inspector.get_columns("users")]
    if "uid" in columns:
        op.drop_column("users", "uid")
