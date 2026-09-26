"""add session token and termination status

Revision ID: e9b535c1d547
Revises: 0005_notifications
Create Date: 2026-03-22 01:13:28.108901

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e9b535c1d547'
down_revision: Union[str, None] = '0005_notifications'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add session_token to users
    op.add_column('users', sa.Column('session_token', sa.String(length=36), nullable=True))
    
    # Add 'terminated' to 'membership_status' ENUM
    # Alembic doesn't natively support altering an enum with op.alter_column in a clean way for postgres ADD VALUE
    try:
        op.execute("ALTER TYPE membership_status ADD VALUE 'terminated'")
    except Exception:
        # If it already exists or on a DB engine that doesn't support this
        pass

def downgrade() -> None:
    op.drop_column('users', 'session_token')
    # PostgreSQL doesn't easily support dropping a value from an enum.
    # We will leave the enum state as is during downgrade.
