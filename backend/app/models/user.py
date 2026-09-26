import secrets
import string
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.enums import UserRole

# Numeric-only random code (e.g. 15121519)
_UID_ALPHABET = string.digits
_UID_LENGTH = 8


def _generate_uid() -> str:
    return "".join(secrets.choice(_UID_ALPHABET) for _ in range(_UID_LENGTH))


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index(
            "ix_users_email_active_unique",
            "email",
            unique=True,
            sqlite_where=text("is_active = 1"),
            postgresql_where=text("is_active = true"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    uid: Mapped[str] = mapped_column(String(16), unique=True, index=True, nullable=False, default=_generate_uid)
    email: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    session_token: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
