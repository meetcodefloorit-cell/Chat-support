import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api.routes import admin as admin_routes
from app.api.routes import projects as project_routes
from app.api.routes import users as users_routes
from app.core.config import settings
from app.core.deps import ensure_project_access
from app.schemas import UserCreate
from app.models import (
    Conversation,
    ConversationType,
    MemberAssignment,
    MembershipStatus,
    MessageType,
    OperatorAssignment,
    Project,
    ProjectUser,
    User,
    UserRole,
)
from app.schemas import MemberReassignRequest, ProjectCreate, ProjectUpdate
from app.services import assignment_service, conversation_service, project_service


def _user(email: str, role: UserRole) -> User:
    return User(email=email, name=email.split("@")[0], password_hash="x", role=role, is_active=True)


def _setup_project(db):
    project = Project(name="Demo", logo_url=None, is_active=True)
    db.add(project)
    db.flush()
    return project


def _add_membership(db, project_id: int, user_id: int, role: UserRole):
    db.add(
        ProjectUser(
            project_id=project_id,
            user_id=user_id,
            role_override=role,
            status=MembershipStatus.ACTIVE,
        )
    )


def test_operator_cannot_access_other_operator_member_conversation(db):
    admin = _user("admin@test.com", UserRole.ADMIN)
    op1 = _user("op1@test.com", UserRole.OPERATOR)
    op2 = _user("op2@test.com", UserRole.OPERATOR)
    member = _user("member@test.com", UserRole.MEMBER)
    db.add_all([admin, op1, op2, member])
    db.flush()

    project = _setup_project(db)

    for user, role in [(admin, UserRole.ADMIN), (op1, UserRole.OPERATOR), (op2, UserRole.OPERATOR), (member, UserRole.MEMBER)]:
        _add_membership(db, project.id, user.id, role)

    db.add_all(
        [
            OperatorAssignment(project_id=project.id, admin_id=admin.id, operator_id=op1.id, is_active=True),
            OperatorAssignment(project_id=project.id, admin_id=admin.id, operator_id=op2.id, is_active=True),
            MemberAssignment(project_id=project.id, operator_id=op1.id, member_id=member.id, is_active=True),
        ]
    )

    conversation = Conversation(
        project_id=project.id,
        type=ConversationType.OPERATOR_MEMBER,
        operator_id=op1.id,
        member_id=member.id,
        admin_id=None,
    )
    db.add(conversation)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        conversation_service.assert_conversation_access(
            db,
            conversation=conversation,
            project_id=project.id,
            user=op2,
        )

    assert exc.value.status_code == 403


def test_member_cannot_access_other_member_conversation(db):
    admin = _user("admin2@test.com", UserRole.ADMIN)
    operator = _user("op@test.com", UserRole.OPERATOR)
    member1 = _user("member1@test.com", UserRole.MEMBER)
    member2 = _user("member2@test.com", UserRole.MEMBER)
    db.add_all([admin, operator, member1, member2])
    db.flush()

    project = _setup_project(db)
    for user, role in [
        (admin, UserRole.ADMIN),
        (operator, UserRole.OPERATOR),
        (member1, UserRole.MEMBER),
        (member2, UserRole.MEMBER),
    ]:
        _add_membership(db, project.id, user.id, role)

    db.add_all(
        [
            OperatorAssignment(project_id=project.id, admin_id=admin.id, operator_id=operator.id, is_active=True),
            MemberAssignment(project_id=project.id, operator_id=operator.id, member_id=member1.id, is_active=True),
        ]
    )

    conversation = Conversation(
        project_id=project.id,
        type=ConversationType.OPERATOR_MEMBER,
        operator_id=operator.id,
        member_id=member1.id,
        admin_id=None,
    )
    db.add(conversation)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        conversation_service.assert_conversation_access(
            db,
            conversation=conversation,
            project_id=project.id,
            user=member2,
        )

    assert exc.value.status_code == 403


def test_admin_broadcast_writes_operator_member_message(db):
    admin = _user("admin3@test.com", UserRole.ADMIN)
    operator = _user("op3@test.com", UserRole.OPERATOR)
    member = _user("member3@test.com", UserRole.MEMBER)
    db.add_all([admin, operator, member])
    db.flush()

    project = _setup_project(db)
    for user, role in [(admin, UserRole.ADMIN), (operator, UserRole.OPERATOR), (member, UserRole.MEMBER)]:
        _add_membership(db, project.id, user.id, role)

    db.add_all(
        [
            OperatorAssignment(project_id=project.id, admin_id=admin.id, operator_id=operator.id, is_active=True),
            MemberAssignment(project_id=project.id, operator_id=operator.id, member_id=member.id, is_active=True),
        ]
    )
    db.commit()

    messages = conversation_service.broadcast_admin_message(
        db,
        project_id=project.id,
        admin=admin,
        target_member_ids=[member.id],
        all_members=False,
        content="Maintenance notice",
    )
    db.commit()

    assert len(messages) == 1
    assert messages[0].message_type.value == "admin_broadcast"

    conversation = conversation_service.get_conversation_or_404(db, messages[0].conversation_id)
    assert conversation.type == ConversationType.OPERATOR_MEMBER
    assert conversation.member_id == member.id


def test_operator_assign_member_requires_operator_project_assignment(db):
    operator = _user("op4@test.com", UserRole.OPERATOR)
    member = _user("member4@test.com", UserRole.MEMBER)
    admin = _user("admin4@test.com", UserRole.ADMIN)
    db.add_all([operator, member, admin])
    db.flush()

    project = _setup_project(db)
    _add_membership(db, project.id, operator.id, UserRole.OPERATOR)
    _add_membership(db, project.id, member.id, UserRole.MEMBER)
    _add_membership(db, project.id, admin.id, UserRole.ADMIN)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        assignment_service.operator_assign_member(db, project_id=project.id, operator=operator, member_id=member.id)

    assert exc.value.status_code == 403


def test_operator_inbox_shows_member_after_first_message_from_any_side(db):
    admin = _user("admin5@test.com", UserRole.ADMIN)
    operator = _user("op5@test.com", UserRole.OPERATOR)
    member = _user("member5@test.com", UserRole.MEMBER)
    db.add_all([admin, operator, member])
    db.flush()

    project = _setup_project(db)
    for user, role in [(admin, UserRole.ADMIN), (operator, UserRole.OPERATOR), (member, UserRole.MEMBER)]:
        _add_membership(db, project.id, user.id, role)

    db.add_all(
        [
            OperatorAssignment(project_id=project.id, admin_id=admin.id, operator_id=operator.id, is_active=True),
            MemberAssignment(project_id=project.id, operator_id=operator.id, member_id=member.id, is_active=True),
        ]
    )
    db.commit()

    conv = conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project.id,
        operator_id=operator.id,
        member_id=member.id,
    )
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=operator,
        content="Welcome from operator",
        conversation=conv,
        message_type=MessageType.TEXT,
    )
    db.commit()

    operator_view_before = conversation_service.list_conversations(
        db,
        project_id=project.id,
        user=operator,
    )
    assert any(c.id == conv.id for c in operator_view_before)

    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=member,
        content="Hello operator",
        conversation=conv,
        message_type=MessageType.TEXT,
    )
    db.commit()

    operator_view_after = conversation_service.list_conversations(
        db,
        project_id=project.id,
        user=operator,
    )
    assert any(c.id == conv.id for c in operator_view_after)


def test_regular_admin_can_reassign_member_within_project(db):
    super_admin = _user("super-admin@test.com", UserRole.ADMIN)
    regular_admin = _user("regular-admin@test.com", UserRole.ADMIN)
    operator_a = _user("operator-a@test.com", UserRole.OPERATOR)
    operator_b = _user("operator-b@test.com", UserRole.OPERATOR)
    member = _user("member-reassign@test.com", UserRole.MEMBER)
    db.add_all([super_admin, regular_admin, operator_a, operator_b, member])
    db.flush()

    project = _setup_project(db)
    for user, role in [
        (super_admin, UserRole.ADMIN),
        (regular_admin, UserRole.ADMIN),
        (operator_a, UserRole.OPERATOR),
        (operator_b, UserRole.OPERATOR),
        (member, UserRole.MEMBER),
    ]:
        _add_membership(db, project.id, user.id, role)

    db.add_all(
        [
            OperatorAssignment(project_id=project.id, admin_id=super_admin.id, operator_id=operator_a.id, is_active=True),
            OperatorAssignment(project_id=project.id, admin_id=super_admin.id, operator_id=operator_b.id, is_active=True),
            MemberAssignment(project_id=project.id, operator_id=operator_a.id, member_id=member.id, is_active=True),
        ]
    )
    db.commit()

    response = admin_routes.admin_assign_member_operator(
        project_id=project.id,
        member_id=member.id,
        payload=MemberReassignRequest(operator_id=operator_b.id),
        db=db,
        current_user=regular_admin,
    )

    db.refresh(member)
    reassigned = db.scalar(
        select(MemberAssignment).where(
            MemberAssignment.project_id == project.id,
            MemberAssignment.member_id == member.id,
            MemberAssignment.is_active.is_(True),
        )
    )
    assert response.detail == "Member assigned successfully"
    assert reassigned is not None
    assert reassigned.operator_id == operator_b.id


def test_shared_admin_can_send_admin_operator_message_without_project_membership(db):
    owner_admin = _user("owner-admin@test.com", UserRole.ADMIN)
    shared_admin = _user("shared-admin@test.com", UserRole.ADMIN)
    operator = _user("shared-op@test.com", UserRole.OPERATOR)
    db.add_all([owner_admin, shared_admin, operator])
    db.flush()

    project = _setup_project(db)
    _add_membership(db, project.id, owner_admin.id, UserRole.ADMIN)
    _add_membership(db, project.id, operator.id, UserRole.OPERATOR)
    db.add(
        OperatorAssignment(
            project_id=project.id,
            admin_id=owner_admin.id,
            operator_id=operator.id,
            is_active=True,
        )
    )
    db.flush()

    conversation = conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=project.id,
        admin_id=owner_admin.id,
        operator_id=operator.id,
    )

    message = conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conversation.id,
        sender=shared_admin,
        content="shared admin reply",
        conversation=conversation,
        message_type=MessageType.TEXT,
    )
    db.commit()

    assert message.conversation_id == conversation.id
    assert message.sender_user_id == shared_admin.id


def test_list_conversations_does_not_create_missing_assignment_threads_on_read(db):
    admin = _user("repair-admin@test.com", UserRole.ADMIN)
    operator = _user("repair-operator@test.com", UserRole.OPERATOR)
    member = _user("repair-member@test.com", UserRole.MEMBER)
    db.add_all([admin, operator, member])
    db.flush()

    project = _setup_project(db)
    for user, role in [
        (admin, UserRole.ADMIN),
        (operator, UserRole.OPERATOR),
        (member, UserRole.MEMBER),
    ]:
        _add_membership(db, project.id, user.id, role)

    db.add_all(
        [
            OperatorAssignment(project_id=project.id, admin_id=admin.id, operator_id=operator.id, is_active=True),
            MemberAssignment(project_id=project.id, operator_id=operator.id, member_id=member.id, is_active=True),
        ]
    )
    db.commit()

    member_view = conversation_service.list_conversations(
        db,
        project_id=project.id,
        user=member,
    )

    assert member_view == []
    assert db.scalar(select(Conversation.id).where(Conversation.project_id == project.id)) is None

    repaired = conversation_service.repair_active_assignment_conversations(db, project_id=project.id)
    db.commit()

    repaired_member_view = conversation_service.list_conversations(
        db,
        project_id=project.id,
        user=member,
    )

    assert repaired == 2
    assert len(repaired_member_view) == 1
    assert repaired_member_view[0].operator_id == operator.id


# ---------------------------------------------------------------------------
# Operator multi-project access (operator project access spec)
# ---------------------------------------------------------------------------

def test_operator_with_multiple_assignments_sees_only_assigned_projects(db):
    admin = _user("admin_multi@t.com", UserRole.ADMIN)
    operator = _user("op_multi@t.com", UserRole.OPERATOR)
    db.add_all([admin, operator])
    db.flush()

    project_a = _setup_project(db)
    project_b = Project(name="Legal Support", logo_url=None, is_active=True)
    project_c = Project(name="Medical Support (not assigned)", logo_url=None, is_active=True)
    db.add_all([project_b, project_c])
    db.flush()

    for project in (project_a, project_b, project_c):
        _add_membership(db, project.id, admin.id, UserRole.ADMIN)
    _add_membership(db, project_a.id, operator.id, UserRole.OPERATOR)
    _add_membership(db, project_b.id, operator.id, UserRole.OPERATOR)

    db.add_all(
        [
            OperatorAssignment(project_id=project_a.id, admin_id=admin.id, operator_id=operator.id, is_active=True),
            OperatorAssignment(project_id=project_b.id, admin_id=admin.id, operator_id=operator.id, is_active=True),
        ]
    )
    db.commit()

    visible = project_service.list_projects_for_user(db, operator)
    visible_ids = {p.id for p in visible}

    assert visible_ids == {project_a.id, project_b.id}
    assert project_c.id not in visible_ids


def test_ensure_project_access_allows_assigned_project_and_rejects_unassigned(db):
    admin = _user("admin_ensure@t.com", UserRole.ADMIN)
    operator = _user("op_ensure@t.com", UserRole.OPERATOR)
    db.add_all([admin, operator])
    db.flush()

    project_a = _setup_project(db)
    project_b = Project(name="Other Project", logo_url=None, is_active=True)
    db.add(project_b)
    db.flush()

    _add_membership(db, project_a.id, admin.id, UserRole.ADMIN)
    _add_membership(db, project_a.id, operator.id, UserRole.OPERATOR)
    db.add(OperatorAssignment(project_id=project_a.id, admin_id=admin.id, operator_id=operator.id, is_active=True))
    db.commit()

    # Allowed: operator's own assigned project.
    allowed = ensure_project_access(db, operator, project_a.id)
    assert allowed.id == project_a.id

    # Rejected: changing the project ID to an unassigned project must 403, not silently pass.
    with pytest.raises(HTTPException) as exc:
        ensure_project_access(db, operator, project_b.id)
    assert exc.value.status_code == 403

    # Rejected: operator with no assignment at all anywhere.
    unassigned_operator = _user("op_none@t.com", UserRole.OPERATOR)
    db.add(unassigned_operator)
    db.commit()
    with pytest.raises(HTTPException) as exc2:
        ensure_project_access(db, unassigned_operator, project_a.id)
    assert exc2.value.status_code == 403


def test_ensure_project_access_rejects_inactive_operator_assignment(db):
    """Removing/deactivating an OperatorAssignment must immediately revoke API access."""
    admin = _user("admin_revoke@t.com", UserRole.ADMIN)
    operator = _user("op_revoke@t.com", UserRole.OPERATOR)
    db.add_all([admin, operator])
    db.flush()

    project = _setup_project(db)
    _add_membership(db, project.id, admin.id, UserRole.ADMIN)
    _add_membership(db, project.id, operator.id, UserRole.OPERATOR)
    db.commit()

    assignment_service.admin_assign_operator(db, project_id=project.id, admin=admin, operator_id=operator.id)
    db.commit()

    assert ensure_project_access(db, operator, project.id).id == project.id

    assignment_service.admin_remove_operator(db, project_id=project.id, operator_id=operator.id, terminate=False)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        ensure_project_access(db, operator, project.id)
    assert exc.value.status_code == 403


def test_ensure_project_access_allows_terminated_operator_for_help_channel(db):
    admin = _user("admin_term_help@t.com", UserRole.ADMIN)
    operator = _user("op_term_help@t.com", UserRole.OPERATOR)
    db.add_all([admin, operator])
    db.flush()

    project = _setup_project(db)
    _add_membership(db, project.id, admin.id, UserRole.ADMIN)
    _add_membership(db, project.id, operator.id, UserRole.OPERATOR)
    db.add(OperatorAssignment(project_id=project.id, admin_id=admin.id, operator_id=operator.id, is_active=True))
    db.commit()

    assignment_service.terminate_user_in_project(db, project_id=project.id, user_id=operator.id)
    db.commit()

    # Project-level access must remain so the terminated operator can reach the admin-help
    # conversation; conversation_service.assert_conversation_access is the finer-grained gate.
    project_access = ensure_project_access(db, operator, project.id)
    assert project_access.id == project.id


def test_operator_cannot_access_conversation_via_wrong_project_id(db):
    """A valid conversation ID belonging to Project B must be rejected when requested under Project A."""
    admin = _user("admin_wrongproj@t.com", UserRole.ADMIN)
    op_a = _user("op_wrongproj_a@t.com", UserRole.OPERATOR)
    op_b = _user("op_wrongproj_b@t.com", UserRole.OPERATOR)
    db.add_all([admin, op_a, op_b])
    db.flush()

    project_a = _setup_project(db)
    project_b = Project(name="Project B", logo_url=None, is_active=True)
    db.add(project_b)
    db.flush()

    for project, operator in [(project_a, op_a), (project_b, op_b)]:
        _add_membership(db, project.id, admin.id, UserRole.ADMIN)
        _add_membership(db, project.id, operator.id, UserRole.OPERATOR)
        db.add(OperatorAssignment(project_id=project.id, admin_id=admin.id, operator_id=operator.id, is_active=True))
    db.commit()

    conv_b = conversation_service.get_or_create_admin_operator_conversation(
        db, project_id=project_b.id, admin_id=admin.id, operator_id=op_b.id,
    )
    db.commit()

    # op_b legitimately owns conv_b, but requesting it scoped to project_a must be rejected.
    with pytest.raises(HTTPException) as exc:
        conversation_service.list_messages(
            db, project_id=project_a.id, conversation_id=conv_b.id, user=op_b,
        )
    assert exc.value.status_code == 404

    with pytest.raises(HTTPException) as exc2:
        conversation_service.create_message(
            db,
            project_id=project_a.id,
            conversation_id=conv_b.id,
            sender=op_b,
            content="cross-project attempt",
        )
    assert exc2.value.status_code == 404


def test_operator_user_listing_scoped_to_own_assigned_members_only(db):
    """GET /users?role=MEMBER as an operator must not leak members from other operators/projects."""
    admin = _user("admin_userlist@t.com", UserRole.ADMIN)
    op_a = _user("op_userlist_a@t.com", UserRole.OPERATOR)
    op_b = _user("op_userlist_b@t.com", UserRole.OPERATOR)
    member_a = _user("member_userlist_a@t.com", UserRole.MEMBER)
    member_b = _user("member_userlist_b@t.com", UserRole.MEMBER)
    db.add_all([admin, op_a, op_b, member_a, member_b])
    db.flush()

    project_a = _setup_project(db)
    project_b = Project(name="Other Project", logo_url=None, is_active=True)
    db.add(project_b)
    db.flush()

    _add_membership(db, project_a.id, admin.id, UserRole.ADMIN)
    _add_membership(db, project_a.id, op_a.id, UserRole.OPERATOR)
    _add_membership(db, project_a.id, member_a.id, UserRole.MEMBER)
    _add_membership(db, project_b.id, admin.id, UserRole.ADMIN)
    _add_membership(db, project_b.id, op_b.id, UserRole.OPERATOR)
    _add_membership(db, project_b.id, member_b.id, UserRole.MEMBER)

    db.add_all(
        [
            OperatorAssignment(project_id=project_a.id, admin_id=admin.id, operator_id=op_a.id, is_active=True),
            OperatorAssignment(project_id=project_b.id, admin_id=admin.id, operator_id=op_b.id, is_active=True),
            MemberAssignment(project_id=project_a.id, operator_id=op_a.id, member_id=member_a.id, is_active=True),
            MemberAssignment(project_id=project_b.id, operator_id=op_b.id, member_id=member_b.id, is_active=True),
        ]
    )
    db.commit()

    result = users_routes.list_users(role=UserRole.MEMBER, db=db, current_user=op_a)
    result_ids = {u.id for u in result}

    assert result_ids == {member_a.id}
    assert member_b.id not in result_ids


# ---------------------------------------------------------------------------
# Operator restrictions on admin-only project management routes
# ---------------------------------------------------------------------------

def test_operator_cannot_manage_projects_or_logo(db):
    admin = _user("admin_projmgmt@t.com", UserRole.ADMIN)
    operator = _user("op_projmgmt@t.com", UserRole.OPERATOR)
    db.add_all([admin, operator])
    db.flush()

    project = _setup_project(db)
    _add_membership(db, project.id, admin.id, UserRole.ADMIN)
    _add_membership(db, project.id, operator.id, UserRole.OPERATOR)
    db.add(OperatorAssignment(project_id=project.id, admin_id=admin.id, operator_id=operator.id, is_active=True))
    db.commit()

    with pytest.raises(HTTPException) as exc:
        project_routes.create_project(
            payload=ProjectCreate(name="Should fail"), db=db, current_user=operator,
        )
    assert exc.value.status_code == 403

    with pytest.raises(HTTPException) as exc2:
        project_routes.update_project(
            project_id=project.id, payload=ProjectUpdate(name="Renamed"), db=db, current_user=operator,
        )
    assert exc2.value.status_code == 403

    with pytest.raises(HTTPException) as exc3:
        project_routes.deactivate_project(project_id=project.id, db=db, current_user=operator)
    assert exc3.value.status_code == 403

    with pytest.raises(HTTPException) as exc4:
        project_routes.upload_project_logo(project_id=project.id, file=None, db=db, current_user=operator)
    assert exc4.value.status_code == 403

    with pytest.raises(HTTPException) as exc5:
        project_routes.delete_project_logo(project_id=project.id, db=db, current_user=operator)
    assert exc5.value.status_code == 403


def test_admin_can_remove_project_logo(db):
    admin = _user("admin_logo_remove@t.com", UserRole.ADMIN)
    db.add(admin)
    db.flush()

    project = _setup_project(db)
    project.logo_url = "/api/uploads/logo_does_not_exist_on_disk.png"
    _add_membership(db, project.id, admin.id, UserRole.ADMIN)
    db.commit()

    response = project_routes.delete_project_logo(project_id=project.id, db=db, current_user=admin)
    assert response.status_code == 200

    db.refresh(project)
    assert project.logo_url is None


# ---------------------------------------------------------------------------
# Role hierarchy: only the super admin may create/promote another Admin
# ---------------------------------------------------------------------------

def test_super_admin_can_create_operator_and_admin(db):
    super_admin = _user(settings.super_admin_email, UserRole.ADMIN)
    db.add(super_admin)
    db.commit()

    created_operator = admin_routes.create_user(
        payload=UserCreate(email="new-op@t.com", name="New Op", password="secret123", role=UserRole.OPERATOR),
        db=db,
        current_user=super_admin,
    )
    assert created_operator.role == UserRole.OPERATOR

    created_admin = admin_routes.create_user(
        payload=UserCreate(email="new-admin@t.com", name="New Admin", password="secret123", role=UserRole.ADMIN),
        db=db,
        current_user=super_admin,
    )
    assert created_admin.role == UserRole.ADMIN


def test_regular_admin_can_create_operator_but_not_admin(db):
    regular_admin = _user("regular-admin-create@t.com", UserRole.ADMIN)
    db.add(regular_admin)
    db.commit()
    assert regular_admin.email.lower() != settings.super_admin_email.lower()

    created_operator = admin_routes.create_user(
        payload=UserCreate(email="new-op2@t.com", name="New Op 2", password="secret123", role=UserRole.OPERATOR),
        db=db,
        current_user=regular_admin,
    )
    assert created_operator.role == UserRole.OPERATOR

    with pytest.raises(HTTPException) as exc:
        admin_routes.create_user(
            payload=UserCreate(email="sneaky-admin@t.com", name="Sneaky", password="secret123", role=UserRole.ADMIN),
            db=db,
            current_user=regular_admin,
        )
    assert exc.value.status_code == 403

    assert db.scalar(select(User).where(User.email == "sneaky-admin@t.com")) is None
