"""User-related services: unique numeric uid generation."""

import secrets
import string
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import User

_UID_ALPHABET = string.digits
_UID_LENGTH = 8
_MAX_UID_RETRIES = 20


def normalize_email(value: str) -> str:
    return (value or "").strip()


def get_active_user_by_email(db: Session, email: str) -> User | None:
    normalized = normalize_email(email)
    if not normalized:
        return None
    return db.scalar(
        select(User).where(
            User.email == normalized,
            User.is_active.is_(True),
        )
    )


def _generate_uid_candidate() -> str:
    return "".join(secrets.choice(_UID_ALPHABET) for _ in range(_UID_LENGTH))


def generate_unique_uid(db: Session) -> str:
    """Generate a numeric-only uid that does not exist in the DB. Collision-safe with retries."""
    for _ in range(_MAX_UID_RETRIES):
        uid = _generate_uid_candidate()
        if db.scalar(select(User).where(User.uid == uid)) is None:
            return uid
    raise ValueError("Could not generate unique uid after retries")


def is_valid_numeric_uid(value: str) -> bool:
    """Return True if value is non-empty and numeric-only (e.g. 8-digit access ID)."""
    return bool(value and value.isdigit() and len(value) <= 16)
