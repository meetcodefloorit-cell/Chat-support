import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import validate_user_session
from app.core.security import decode_access_token
from app.models import User, UserRole, UserSession
from app.services import auth_service


def _user(db: Session, email: str, role: UserRole) -> User:
    u = User(
        email=email,
        name=email.split("@")[0],
        password_hash="x",
        role=role,
        is_active=True,
    )
    db.add(u)
    db.flush()
    return u


def test_operator_single_session_only(db: Session):
    operator = _user(db, "op_one_device@test.com", UserRole.OPERATOR)

    token1 = auth_service.build_login_token(db, operator)
    payload1 = decode_access_token(token1)
    validate_user_session(db, user=operator, payload=payload1)

    token2 = auth_service.build_login_token(db, operator)
    payload2 = decode_access_token(token2)
    validate_user_session(db, user=operator, payload=payload2)

    with pytest.raises(HTTPException) as exc:
        validate_user_session(db, user=operator, payload=payload1)
    assert exc.value.status_code == 401

    sessions = list(db.scalars(select(UserSession).where(UserSession.user_id == operator.id)).all())
    assert len(sessions) == 1


def test_admin_up_to_three_concurrent_sessions(db: Session):
    admin = _user(db, "admin_three_devices@test.com", UserRole.ADMIN)

    tokens = [auth_service.build_login_token(db, admin) for _ in range(4)]
    payloads = [decode_access_token(tok) for tok in tokens]

    # Oldest session should be pruned; latest 3 should remain valid.
    with pytest.raises(HTTPException) as exc:
        validate_user_session(db, user=admin, payload=payloads[0])
    assert exc.value.status_code == 401

    validate_user_session(db, user=admin, payload=payloads[1])
    validate_user_session(db, user=admin, payload=payloads[2])
    validate_user_session(db, user=admin, payload=payloads[3])

    sessions = list(db.scalars(select(UserSession).where(UserSession.user_id == admin.id)).all())
    assert len(sessions) == 3


def test_member_unlimited_sessions(db: Session):
    member = _user(db, "member_unlimited@test.com", UserRole.MEMBER)

    token1 = auth_service.build_login_token(db, member)
    token2 = auth_service.build_login_token(db, member)

    payload1 = decode_access_token(token1)
    payload2 = decode_access_token(token2)

    validate_user_session(db, user=member, payload=payload1)
    validate_user_session(db, user=member, payload=payload2)

    # Member sessions are intentionally unrestricted and not persisted in user_sessions.
    sessions = list(db.scalars(select(UserSession).where(UserSession.user_id == member.id)).all())
    assert len(sessions) == 0
