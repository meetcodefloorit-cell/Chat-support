from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
import uuid

from app.core.security import create_access_token, verify_password
from app.models import MemberAssignment, User, UserRole, UserSession
from app.services.user_service import is_valid_numeric_uid

ADMIN_MAX_SESSIONS = 3


def authenticate_user(db: Session, identifier: str, password: str) -> User:
    """Authenticate by email or numeric access ID (uid). Identifier must be email or numeric-only."""
    identifier = (identifier or "").strip()
    if not identifier:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    if "@" in identifier:
        user = db.scalar(
            select(User).where(
                User.email == identifier,
                User.is_active.is_(True),
            )
        )
    elif is_valid_numeric_uid(identifier):
        user = db.scalar(select(User).where(User.uid == identifier))
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Identifier must be an email or numeric access ID")

    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    # Member must have at least one active operator assignment to log in
    if user.role == UserRole.MEMBER:
        has_assignment = db.scalar(
            select(MemberAssignment).where(
                MemberAssignment.member_id == user.id,
                MemberAssignment.is_active.is_(True),
            )
        ) is not None
        if not has_assignment:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No operator assigned. Please contact your operator to get access.",
            )

    return user


def _prune_admin_sessions(db: Session, *, user_id: int) -> None:
    sessions = list(
        db.scalars(
            select(UserSession)
            .where(UserSession.user_id == user_id)
            .order_by(UserSession.created_at.desc(), UserSession.id.desc())
        ).all()
    )
    for stale in sessions[ADMIN_MAX_SESSIONS:]:
        db.delete(stale)


def build_login_token(db: Session, user: User) -> str:
    # Members: unrestricted concurrent sessions; no server-side session row required.
    if user.role == UserRole.MEMBER:
        return create_access_token(subject=str(user.id))

    session_token = str(uuid.uuid4())

    if user.role == UserRole.OPERATOR:
        # Operators: single-device policy. New login invalidates all previous logins.
        db.execute(delete(UserSession).where(UserSession.user_id == user.id))
        db.add(UserSession(user_id=user.id, session_token=session_token))
        user.session_token = session_token
        db.commit()
        return create_access_token(subject=str(user.id), session_token=session_token)

    if user.role == UserRole.ADMIN:
        # Admins: keep up to 3 most-recent active sessions.
        db.add(UserSession(user_id=user.id, session_token=session_token))
        user.session_token = session_token
        db.flush()
        _prune_admin_sessions(db, user_id=user.id)
        db.commit()
        return create_access_token(subject=str(user.id), session_token=session_token)

    # Fallback for any future role types.
    return create_access_token(subject=str(user.id))
