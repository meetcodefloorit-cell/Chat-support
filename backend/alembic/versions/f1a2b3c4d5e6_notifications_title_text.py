"""notifications.title as Text for full announcement/message body

Revision ID: f1a2b3c4d5e6
Revises: e9b535c1d547
Create Date: 2026-03-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e9b535c1d547"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column(
        "notifications",
        "title",
        existing_type=sa.String(255),
        type_=sa.Text(),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.alter_column(
        "notifications",
        "title",
        existing_type=sa.Text(),
        type_=sa.String(255),
        existing_nullable=False,
    )
