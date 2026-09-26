from app.models import User, UserRole
from app.schemas.project import ProjectCreate, ProjectUpdate
from app.services import project_service


def _admin() -> User:
    return User(
        email="admin@test.com",
        name="Admin",
        password_hash="x",
        role=UserRole.ADMIN,
        is_active=True,
    )


def test_project_support_fields_create_and_update(db):
    admin = _admin()
    db.add(admin)
    db.flush()

    created = project_service.create_project(
        db,
        ProjectCreate(
            name="Support Project",
            logo_url="https://example.com/logo.png",
            support_email="help@example.com",
            support_phone="+1 555 111 0000",
        ),
        admin,
    )
    db.commit()

    assert created.support_email == "help@example.com"
    assert created.support_phone == "+1 555 111 0000"

    updated = project_service.update_project(
        created,
        ProjectUpdate(
            support_email="new-help@example.com",
            support_phone="+1 555 222 0000",
        ),
    )
    db.commit()

    assert updated.support_email == "new-help@example.com"
    assert updated.support_phone == "+1 555 222 0000"
