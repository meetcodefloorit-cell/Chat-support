"""add operator_terminated_message to projects

Revision ID: 2f4c6a9e1b7d
Revises: f1a2b3c4d5e6
Create Date: 2026-03-10
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "2f4c6a9e1b7d"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("projects", sa.Column("operator_terminated_message", sa.String(length=500), nullable=True))


def downgrade() -> None:
    op.drop_column("projects", "operator_terminated_message")
