import pytest
from fastapi import HTTPException

from app.models import User, UserRole
from app.services import assignment_service


def test_deactivate_user_globally_blocks_admin(db):
    admin = User(email="admin@test.com", name="Admin", password_hash="x", role=UserRole.ADMIN, is_active=True)
    db.add(admin)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        assignment_service.deactivate_user_globally(db, user_id=admin.id)

    assert exc.value.status_code == 400
