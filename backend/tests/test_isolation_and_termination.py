"""Tests for project isolation, termination semantics, recipient scoping, logo upload, and UID uniqueness."""

import asyncio
from collections import Counter

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.api.routes import admin as admin_routes
from app.models import (
    Conversation,
    ConversationType,
    MemberAssignment,
    MembershipStatus,
    Message,
    MessageType,
    Notification,
    OperatorAssignment,
    Project,
    ProjectUser,
    User,
    UserRole,
)
from app.api.routes.projects import (
    delete_project as delete_project_route,
    permanently_delete_project as permanently_delete_project_route,
)
from app.schemas import BroadcastRequest, BulkDeactivateUsersRequest
from app.services import assignment_service, auth_service, conversation_service, project_service


def _user(db: Session, email: str, role: UserRole) -> User:
    u = User(email=email, name=email.split("@")[0], password_hash="x", role=role, is_active=True)
    db.add(u)
    db.flush()
    return u


def _project(db: Session, name: str = "Proj") -> Project:
    p = Project(name=name, logo_url=None, is_active=True)
    db.add(p)
    db.flush()
    return p


def _membership(db: Session, project_id: int, user_id: int, role: UserRole) -> None:
    db.add(ProjectUser(project_id=project_id, user_id=user_id, role_override=role, status=MembershipStatus.ACTIVE))
    db.flush()


def _operator_assignment(db: Session, project_id: int, admin_id: int, operator_id: int) -> OperatorAssignment:
    oa = OperatorAssignment(project_id=project_id, admin_id=admin_id, operator_id=operator_id, is_active=True)
    db.add(oa)
    db.flush()
    return oa


def _member_assignment(db: Session, project_id: int, operator_id: int, member_id: int) -> MemberAssignment:
    ma = MemberAssignment(project_id=project_id, operator_id=operator_id, member_id=member_id, is_active=True)
    db.add(ma)
    db.flush()
    return ma


# ---------------------------------------------------------------------------
# UID uniqueness
# ---------------------------------------------------------------------------

def test_user_uid_is_auto_generated(db: Session):
    u1 = _user(db, "a@test.com", UserRole.MEMBER)
    u2 = _user(db, "b@test.com", UserRole.MEMBER)
    db.commit()
    assert u1.uid is not None
    assert u2.uid is not None
    assert len(u1.uid) == 8
    assert u1.uid.isdigit()
    assert u2.uid.isdigit()
    assert u1.uid != u2.uid


# ---------------------------------------------------------------------------
# Permanent delete (Terminate) — removes user account everywhere
# ---------------------------------------------------------------------------

def test_permanently_delete_operator_removes_user_globally(db: Session):
    admin = _user(db, "admin@t.com", UserRole.ADMIN)
    op = _user(db, "op@t.com", UserRole.OPERATOR)
    p1 = _project(db, "P1")
    p2 = _project(db, "P2")

    _membership(db, p1.id, admin.id, UserRole.ADMIN)
    _membership(db, p1.id, op.id, UserRole.OPERATOR)
    _membership(db, p2.id, admin.id, UserRole.ADMIN)
    _membership(db, p2.id, op.id, UserRole.OPERATOR)
    _operator_assignment(db, p1.id, admin.id, op.id)
    _operator_assignment(db, p2.id, admin.id, op.id)
    db.commit()

    op_id = op.id
    assignment_service.permanently_delete_user_account(db, user_id=op_id)
    db.commit()

    assert db.get(User, op_id) is None


def test_admin_bulk_permanent_delete_mixed_member_and_operator(db: Session):
    admin = _user(db, "admin_bulk_perma@t.com", UserRole.ADMIN)
    op = _user(db, "op_bulk_perma@t.com", UserRole.OPERATOR)
    member = _user(db, "member_bulk_perma@t.com", UserRole.MEMBER)
    db.commit()

    payload = BulkDeactivateUsersRequest(user_ids=[op.id, member.id, op.id])
    resp = admin_routes.permanently_delete_users_bulk(payload=payload, db=db, current_user=admin)

    assert "permanently deleted" in resp.detail.lower()
    assert db.get(User, op.id) is None
    assert db.get(User, member.id) is None


def test_admin_bulk_permanent_delete_rejects_admin_target(db: Session):
    admin = _user(db, "admin_bulk_owner@t.com", UserRole.ADMIN)
    target_admin = _user(db, "admin_bulk_target@t.com", UserRole.ADMIN)
    member = _user(db, "member_bulk_guard@t.com", UserRole.MEMBER)
    db.commit()

    payload = BulkDeactivateUsersRequest(user_ids=[target_admin.id, member.id])
    with pytest.raises(HTTPException) as exc:
        admin_routes.permanently_delete_users_bulk(payload=payload, db=db, current_user=admin)
    assert exc.value.status_code == 400

    assert db.get(User, target_admin.id) is not None
    assert db.get(User, member.id) is not None


def test_admin_bulk_permanent_delete_rejects_unknown_user_id(db: Session):
    admin = _user(db, "admin_bulk_missing@t.com", UserRole.ADMIN)
    op = _user(db, "op_bulk_missing@t.com", UserRole.OPERATOR)
    db.commit()

    payload = BulkDeactivateUsersRequest(user_ids=[op.id, 999999999])
    with pytest.raises(HTTPException) as exc:
        admin_routes.permanently_delete_users_bulk(payload=payload, db=db, current_user=admin)
    assert exc.value.status_code == 404

    assert db.get(User, op.id) is not None


def test_deactivate_user_globally_removes_from_all_projects(db: Session):
    admin = _user(db, "admin2@t.com", UserRole.ADMIN)
    op = _user(db, "op2@t.com", UserRole.OPERATOR)
    p1 = _project(db, "P1")
    p2 = _project(db, "P2")

    _membership(db, p1.id, admin.id, UserRole.ADMIN)
    _membership(db, p1.id, op.id, UserRole.OPERATOR)
    _membership(db, p2.id, admin.id, UserRole.ADMIN)
    _membership(db, p2.id, op.id, UserRole.OPERATOR)
    _operator_assignment(db, p1.id, admin.id, op.id)
    _operator_assignment(db, p2.id, admin.id, op.id)
    db.commit()

    assignment_service.deactivate_user_globally(db, user_id=op.id)
    db.commit()

    db.refresh(op)
    assert op.is_active is False

    for pid in [p1.id, p2.id]:
        mem = db.query(ProjectUser).filter_by(project_id=pid, user_id=op.id).first()
        assert mem.status == MembershipStatus.REMOVED
        oa = db.query(OperatorAssignment).filter_by(project_id=pid, operator_id=op.id).first()
        assert oa.is_active is False


def test_deactivate_operator_globally_releases_assigned_members_for_reassignment(db: Session):
    admin = _user(db, "admin_release@t.com", UserRole.ADMIN)
    op = _user(db, "op_release@t.com", UserRole.OPERATOR)
    member = _user(db, "member_release@t.com", UserRole.MEMBER)
    project = _project(db, "Release Project")

    _membership(db, project.id, admin.id, UserRole.ADMIN)
    _membership(db, project.id, op.id, UserRole.OPERATOR)
    _membership(db, project.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, project.id, admin.id, op.id)
    _member_assignment(db, project.id, op.id, member.id)
    db.commit()

    assignment_service.deactivate_user_globally(db, user_id=op.id)
    db.commit()

    member_assignment = db.query(MemberAssignment).filter_by(project_id=project.id, member_id=member.id).first()
    assert member_assignment is not None
    assert member_assignment.is_active is False

    member_membership = db.query(ProjectUser).filter_by(project_id=project.id, user_id=member.id).first()
    assert member_membership is not None
    assert member_membership.status == MembershipStatus.ACTIVE

    member_rows = assignment_service.list_project_members_with_operators(db, project_id=project.id)
    member_row = next(row for row in member_rows if row["id"] == member.id)
    assert member_row["assigned_operator_id"] is None
    assert member_row["membership_status"] == MembershipStatus.ACTIVE.value


def test_deactivated_operator_email_can_be_reused_for_new_active_user(db: Session):
    old_operator = _user(db, "reuse_operator@t.com", UserRole.OPERATOR)
    db.commit()

    assignment_service.deactivate_user_globally(db, user_id=old_operator.id)
    db.commit()

    replacement = User(
        email="reuse_operator@t.com",
        name="Replacement Operator",
        password_hash="x",
        role=UserRole.OPERATOR,
        is_active=True,
    )
    db.add(replacement)
    db.commit()

    assert replacement.email == "reuse_operator@t.com"
    assert replacement.id != old_operator.id
    assert db.get(User, old_operator.id).is_active is False


def test_deactivated_member_email_can_be_reused_for_new_member(db: Session):
    old_member = _user(db, "reuse_member@t.com", UserRole.MEMBER)
    db.commit()

    assignment_service.deactivate_user_globally(db, user_id=old_member.id)
    db.commit()

    replacement = User(
        email="reuse_member@t.com",
        name="New Member",
        password_hash="x",
        role=UserRole.MEMBER,
        is_active=True,
    )
    db.add(replacement)
    db.commit()

    assert replacement.email == "reuse_member@t.com"
    assert replacement.id != old_member.id
    assert db.get(User, old_member.id).is_active is False


def test_authenticate_user_by_email_prefers_active_account_when_inactive_duplicate_exists(db: Session, monkeypatch):
    old_operator = User(
        email="email_login_reuse@t.com",
        name="Old Operator",
        password_hash="OldPass123",
        role=UserRole.OPERATOR,
        is_active=True,
    )
    db.add(old_operator)
    db.commit()

    assignment_service.deactivate_user_globally(db, user_id=old_operator.id)
    db.commit()

    new_operator = User(
        email="email_login_reuse@t.com",
        name="New Operator",
        password_hash="NewPass123",
        role=UserRole.OPERATOR,
        is_active=True,
    )
    db.add(new_operator)
    db.commit()

    monkeypatch.setattr(auth_service, "verify_password", lambda plain, stored: plain == stored)

    authenticated = auth_service.authenticate_user(db, "email_login_reuse@t.com", "NewPass123")
    assert authenticated.id == new_operator.id

    with pytest.raises(HTTPException) as exc:
        auth_service.authenticate_user(db, "email_login_reuse@t.com", "OldPass123")
    assert exc.value.status_code == 401


def test_project_history_lists_include_globally_deleted_users(db: Session):
    admin = _user(db, "admin_history@t.com", UserRole.ADMIN)
    operator = _user(db, "operator_history@t.com", UserRole.OPERATOR)
    member = _user(db, "member_history@t.com", UserRole.MEMBER)
    project = _project(db, "History Project")

    _membership(db, project.id, admin.id, UserRole.ADMIN)
    _membership(db, project.id, operator.id, UserRole.OPERATOR)
    _membership(db, project.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, project.id, admin.id, operator.id)
    _member_assignment(db, project.id, operator.id, member.id)
    db.commit()

    assignment_service.deactivate_user_globally(db, user_id=operator.id)
    assignment_service.deactivate_user_globally(db, user_id=member.id)
    db.commit()

    operator_rows = assignment_service.list_project_operators_with_status(db, project_id=project.id)
    member_rows = assignment_service.list_project_members_with_operators(db, project_id=project.id)

    assert any(row["id"] == operator.id and row["is_active"] is False for row in operator_rows)
    assert any(row["id"] == member.id and row["is_active"] is False for row in member_rows)


def test_permanently_delete_admin_is_rejected(db: Session):
    admin = _user(db, "admin3@t.com", UserRole.ADMIN)
    p = _project(db)
    _membership(db, p.id, admin.id, UserRole.ADMIN)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        assignment_service.permanently_delete_user_account(db, user_id=admin.id)
    assert exc.value.status_code == 400


# ---------------------------------------------------------------------------
# Project-scoped admin recipients
# ---------------------------------------------------------------------------

def test_message_recipients_include_all_active_admins(db: Session):
    admin1 = _user(db, "admin_p1@t.com", UserRole.ADMIN)
    admin2 = _user(db, "admin_p2@t.com", UserRole.ADMIN)
    op = _user(db, "op_r@t.com", UserRole.OPERATOR)

    p1 = _project(db, "P1")
    p2 = _project(db, "P2")

    _membership(db, p1.id, admin1.id, UserRole.ADMIN)
    _membership(db, p1.id, op.id, UserRole.OPERATOR)
    _membership(db, p2.id, admin2.id, UserRole.ADMIN)
    _operator_assignment(db, p1.id, admin1.id, op.id)

    conv = Conversation(
        project_id=p1.id, type=ConversationType.ADMIN_OPERATOR,
        admin_id=admin1.id, operator_id=op.id, member_id=None,
    )
    db.add(conv)
    db.commit()

    recipients = conversation_service.get_message_recipients(db, project_id=p1.id, conversation_id=conv.id)

    assert admin1.id in recipients
    assert op.id in recipients
    assert admin2.id in recipients  # active admins share project inbox work


def test_message_recipients_fallback_to_all_admins_when_no_project_membership(db: Session):
    """When no admin has explicit project membership, fall back to all active admins."""
    admin = _user(db, "super@t.com", UserRole.ADMIN)
    op = _user(db, "op_fb@t.com", UserRole.OPERATOR)

    p = _project(db)
    _membership(db, p.id, op.id, UserRole.OPERATOR)
    _operator_assignment(db, p.id, admin.id, op.id)

    conv = Conversation(
        project_id=p.id, type=ConversationType.ADMIN_OPERATOR,
        admin_id=admin.id, operator_id=op.id, member_id=None,
    )
    db.add(conv)
    db.commit()

    recipients = conversation_service.get_message_recipients(db, project_id=p.id, conversation_id=conv.id)
    assert admin.id in recipients


# ---------------------------------------------------------------------------
# Operator-member isolation across projects
# ---------------------------------------------------------------------------

def test_operator_cannot_assign_member_to_project_they_are_not_assigned_to(db: Session):
    admin = _user(db, "admin_iso@t.com", UserRole.ADMIN)
    op = _user(db, "op_iso@t.com", UserRole.OPERATOR)
    member = _user(db, "mem_iso@t.com", UserRole.MEMBER)

    p1 = _project(db, "P1")
    p2 = _project(db, "P2")

    _membership(db, p1.id, admin.id, UserRole.ADMIN)
    _membership(db, p1.id, op.id, UserRole.OPERATOR)
    _membership(db, p2.id, admin.id, UserRole.ADMIN)
    _membership(db, p2.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, p1.id, admin.id, op.id)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        assignment_service.operator_assign_member(db, project_id=p2.id, operator=op, member_id=member.id)
    assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Broadcast creates messages for targeted members only
# ---------------------------------------------------------------------------

def test_broadcast_creates_messages_for_targeted_members_only(db: Session):
    admin = _user(db, "admin_bc@t.com", UserRole.ADMIN)
    op = _user(db, "op_bc@t.com", UserRole.OPERATOR)
    m1 = _user(db, "m1_bc@t.com", UserRole.MEMBER)
    m2 = _user(db, "m2_bc@t.com", UserRole.MEMBER)

    p = _project(db)
    _membership(db, p.id, admin.id, UserRole.ADMIN)
    _membership(db, p.id, op.id, UserRole.OPERATOR)
    _membership(db, p.id, m1.id, UserRole.MEMBER)
    _membership(db, p.id, m2.id, UserRole.MEMBER)
    _operator_assignment(db, p.id, admin.id, op.id)
    _member_assignment(db, p.id, op.id, m1.id)
    _member_assignment(db, p.id, op.id, m2.id)
    db.commit()

    messages = conversation_service.broadcast_admin_message(
        db, project_id=p.id, admin=admin,
        target_member_ids=[m1.id], all_members=False,
        content="Hello m1 only",
    )
    db.commit()

    assert len(messages) == 1
    conv = conversation_service.get_conversation_or_404(db, messages[0].conversation_id)
    assert conv.member_id == m1.id


def test_broadcast_all_members_creates_one_message_per_assignment(db: Session):
    admin = _user(db, "admin_bca@t.com", UserRole.ADMIN)
    op = _user(db, "op_bca@t.com", UserRole.OPERATOR)
    m1 = _user(db, "m1_bca@t.com", UserRole.MEMBER)
    m2 = _user(db, "m2_bca@t.com", UserRole.MEMBER)

    p = _project(db)
    _membership(db, p.id, admin.id, UserRole.ADMIN)
    _membership(db, p.id, op.id, UserRole.OPERATOR)
    _membership(db, p.id, m1.id, UserRole.MEMBER)
    _membership(db, p.id, m2.id, UserRole.MEMBER)
    _operator_assignment(db, p.id, admin.id, op.id)
    _member_assignment(db, p.id, op.id, m1.id)
    _member_assignment(db, p.id, op.id, m2.id)
    db.commit()

    messages = conversation_service.broadcast_admin_message(
        db, project_id=p.id, admin=admin,
        target_member_ids=None, all_members=True,
        content="Announcement!",
    )
    db.commit()

    assert len(messages) == 2
    member_ids = set()
    for msg in messages:
        conv = conversation_service.get_conversation_or_404(db, msg.conversation_id)
        member_ids.add(conv.member_id)
    assert member_ids == {m1.id, m2.id}


def test_admin_broadcast_chat_route_emits_message_and_notification_events(db: Session, monkeypatch):
    admin = _user(db, "admin_route_bc@t.com", UserRole.ADMIN)
    operator = _user(db, "operator_route_bc@t.com", UserRole.OPERATOR)
    member = _user(db, "member_route_bc@t.com", UserRole.MEMBER)

    project = _project(db, "Route Broadcast")
    _membership(db, project.id, admin.id, UserRole.ADMIN)
    _membership(db, project.id, operator.id, UserRole.OPERATOR)
    _membership(db, project.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, project.id, admin.id, operator.id)
    _member_assignment(db, project.id, operator.id, member.id)
    db.commit()

    events: list[dict] = []

    async def _fake_broadcast(project_id: int, user_ids: list[int], payload: dict) -> None:
        events.append(
            {
                "project_id": project_id,
                "user_ids": tuple(sorted(user_ids)),
                "payload": payload,
            }
        )

    monkeypatch.setattr(admin_routes.manager, "broadcast_to_users", _fake_broadcast)

    payload = BroadcastRequest(
        member_ids=[member.id],
        operator_ids=[operator.id],
        content="System maintenance tonight",
        delivery_method="chat",
    )
    response = asyncio.run(
        admin_routes.broadcast_message(
            project_id=project.id,
            payload=payload,
            db=db,
            current_user=admin,
        )
    )

    assert response.messages_created == 2

    stored_messages = db.query(Message).filter_by(project_id=project.id).all()
    assert len(stored_messages) == 2
    assert all(msg.message_type == MessageType.ADMIN_BROADCAST for msg in stored_messages)

    stored_notifications = db.query(Notification).filter_by(project_id=project.id, kind="admin_broadcast").all()
    assert len(stored_notifications) == 3
    assert Counter(note.user_id for note in stored_notifications) == Counter({operator.id: 2, member.id: 1})
    assert all(note.reference_id is not None for note in stored_notifications)

    message_events = [event for event in events if event["payload"].get("event") == "message:new"]
    count_events = [event for event in events if event["payload"].get("event") == "notification:count"]

    assert len(message_events) == 2
    assert {tuple(event["user_ids"]) for event in message_events} == {
        tuple(sorted([admin.id, operator.id])),
        tuple(sorted([admin.id, operator.id, member.id])),
    }
    assert all(event["payload"]["data"]["message_type"] == "admin_broadcast" for event in message_events)

    count_by_user = {event["user_ids"][0]: event["payload"]["data"]["count"] for event in count_events}
    assert count_by_user == {operator.id: 2, member.id: 1}


def test_admin_broadcast_notification_only_route_updates_counts_without_messages(db: Session, monkeypatch):
    admin = _user(db, "admin_route_note@t.com", UserRole.ADMIN)
    operator = _user(db, "operator_route_note@t.com", UserRole.OPERATOR)
    member = _user(db, "member_route_note@t.com", UserRole.MEMBER)

    project = _project(db, "Route Notification")
    _membership(db, project.id, admin.id, UserRole.ADMIN)
    _membership(db, project.id, operator.id, UserRole.OPERATOR)
    _membership(db, project.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, project.id, admin.id, operator.id)
    _member_assignment(db, project.id, operator.id, member.id)
    db.commit()

    events: list[dict] = []

    async def _fake_broadcast(project_id: int, user_ids: list[int], payload: dict) -> None:
        events.append(
            {
                "project_id": project_id,
                "user_ids": tuple(sorted(user_ids)),
                "payload": payload,
            }
        )

    monkeypatch.setattr(admin_routes.manager, "broadcast_to_users", _fake_broadcast)

    payload = BroadcastRequest(
        member_ids=[member.id],
        operator_ids=[operator.id],
        content="Notification-only announcement",
        delivery_method="notification",
    )
    response = asyncio.run(
        admin_routes.broadcast_message(
            project_id=project.id,
            payload=payload,
            db=db,
            current_user=admin,
        )
    )

    assert response.messages_created == 0
    assert db.query(Message).filter_by(project_id=project.id).count() == 0

    stored_notifications = db.query(Notification).filter_by(project_id=project.id, kind="admin_broadcast").all()
    assert len(stored_notifications) == 2
    assert Counter(note.user_id for note in stored_notifications) == Counter({operator.id: 1, member.id: 1})
    assert all(note.reference_id is None for note in stored_notifications)

    assert [event for event in events if event["payload"].get("event") == "message:new"] == []
    count_by_user = {
        event["user_ids"][0]: event["payload"]["data"]["count"]
        for event in events
        if event["payload"].get("event") == "notification:count"
    }
    assert count_by_user == {operator.id: 1, member.id: 1}


# ---------------------------------------------------------------------------
# Termination cascades operator's member assignments
# ---------------------------------------------------------------------------

def test_delete_operator_removes_assignments_member_stays(db: Session):
    admin = _user(db, "admin_cas@t.com", UserRole.ADMIN)
    op = _user(db, "op_cas@t.com", UserRole.OPERATOR)
    m = _user(db, "m_cas@t.com", UserRole.MEMBER)

    p = _project(db)
    _membership(db, p.id, admin.id, UserRole.ADMIN)
    _membership(db, p.id, op.id, UserRole.OPERATOR)
    _membership(db, p.id, m.id, UserRole.MEMBER)
    _operator_assignment(db, p.id, admin.id, op.id)
    _member_assignment(db, p.id, op.id, m.id)
    db.commit()

    op_id = op.id
    assignment_service.permanently_delete_user_account(db, user_id=op_id)
    db.commit()

    assert db.get(User, op_id) is None
    assert db.get(User, m.id) is not None
    ma = db.query(MemberAssignment).filter_by(project_id=p.id, member_id=m.id).first()
    assert ma is None


def test_delete_project_is_soft_archive_and_keeps_users(db: Session):
    admin = _user(db, "admin_archive@t.com", UserRole.ADMIN)
    op = _user(db, "op_archive@t.com", UserRole.OPERATOR)
    member = _user(db, "member_archive@t.com", UserRole.MEMBER)
    p = _project(db, "Archive Me")

    _membership(db, p.id, admin.id, UserRole.ADMIN)
    _membership(db, p.id, op.id, UserRole.OPERATOR)
    _membership(db, p.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, p.id, admin.id, op.id)
    _member_assignment(db, p.id, op.id, member.id)
    db.commit()

    resp = delete_project_route(project_id=p.id, db=db, current_user=admin)
    assert "archived" in resp["detail"].lower()

    refreshed = db.get(Project, p.id)
    assert refreshed is not None
    assert refreshed.is_active is False

    # Project memberships and user accounts are retained for reuse/reassignment later.
    pu_op = db.query(ProjectUser).filter_by(project_id=p.id, user_id=op.id).first()
    pu_member = db.query(ProjectUser).filter_by(project_id=p.id, user_id=member.id).first()
    assert pu_op is not None
    assert pu_member is not None
    assert db.get(User, op.id) is not None
    assert db.get(User, member.id) is not None


def test_permanent_delete_project_removes_project_scoped_rows_keeps_users(db: Session):
    admin = _user(db, "admin_perm@t.com", UserRole.ADMIN)
    op = _user(db, "op_perm@t.com", UserRole.OPERATOR)
    member = _user(db, "member_perm@t.com", UserRole.MEMBER)
    p = _project(db, "Permanent Remove")

    _membership(db, p.id, admin.id, UserRole.ADMIN)
    _membership(db, p.id, op.id, UserRole.OPERATOR)
    _membership(db, p.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, p.id, admin.id, op.id)
    _member_assignment(db, p.id, op.id, member.id)
    db.commit()

    delete_project_route(project_id=p.id, db=db, current_user=admin)
    resp = permanently_delete_project_route(project_id=p.id, db=db, current_user=admin)
    assert "permanently deleted" in resp["detail"].lower()

    assert db.get(Project, p.id) is None
    assert db.query(ProjectUser).filter_by(project_id=p.id).count() == 0
    assert db.query(OperatorAssignment).filter_by(project_id=p.id).count() == 0
    assert db.query(MemberAssignment).filter_by(project_id=p.id).count() == 0

    # User accounts must remain for reuse in other projects.
    assert db.get(User, admin.id) is not None
    assert db.get(User, op.id) is not None
    assert db.get(User, member.id) is not None


def test_permanent_delete_active_project_is_rejected(db: Session):
    admin = _user(db, "admin_perm2@t.com", UserRole.ADMIN)
    p = _project(db, "Active cannot delete")
    _membership(db, p.id, admin.id, UserRole.ADMIN)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        permanently_delete_project_route(project_id=p.id, db=db, current_user=admin)
    assert exc.value.status_code == 400


def test_permanent_delete_all_projects_keeps_users_visible_globally(db: Session):
    admin = _user(db, "admin_perm_all@t.com", UserRole.ADMIN)
    op = _user(db, "op_perm_all@t.com", UserRole.OPERATOR)
    member = _user(db, "member_perm_all@t.com", UserRole.MEMBER)
    p1 = _project(db, "Delete All 1")
    p2 = _project(db, "Delete All 2")

    for p in (p1, p2):
        _membership(db, p.id, admin.id, UserRole.ADMIN)
        _membership(db, p.id, op.id, UserRole.OPERATOR)
        _membership(db, p.id, member.id, UserRole.MEMBER)
        _operator_assignment(db, p.id, admin.id, op.id)
        _member_assignment(db, p.id, op.id, member.id)
    db.commit()

    for p in (p1, p2):
        delete_project_route(project_id=p.id, db=db, current_user=admin)
        permanently_delete_project_route(project_id=p.id, db=db, current_user=admin)

    assert db.query(Project).count() == 0
    assert db.get(User, op.id) is not None
    assert db.get(User, member.id) is not None

    # Global role lists must still include users even when no project exists.
    operators = assignment_service.list_users_by_role(db, role=UserRole.OPERATOR)
    members = assignment_service.list_users_by_role(db, role=UserRole.MEMBER)
    assert any(u.id == op.id for u in operators)
    assert any(u.id == member.id for u in members)


def test_recreate_project_allows_reassigning_existing_operator_and_member(db: Session):
    admin = _user(db, "admin_recreate@t.com", UserRole.ADMIN)
    op = _user(db, "op_recreate@t.com", UserRole.OPERATOR)
    member = _user(db, "member_recreate@t.com", UserRole.MEMBER)
    old_project = _project(db, "Old Project")

    _membership(db, old_project.id, admin.id, UserRole.ADMIN)
    _membership(db, old_project.id, op.id, UserRole.OPERATOR)
    _membership(db, old_project.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, old_project.id, admin.id, op.id)
    _member_assignment(db, old_project.id, op.id, member.id)
    db.commit()

    delete_project_route(project_id=old_project.id, db=db, current_user=admin)
    permanently_delete_project_route(project_id=old_project.id, db=db, current_user=admin)
    assert db.query(Project).count() == 0

    new_project = _project(db, "New Project")
    db.commit()

    assignable_ops = assignment_service.list_operators_assignable_to_project(db, project_id=new_project.id)
    assert any(u.id == op.id for u in assignable_ops)

    assignment_service.admin_assign_operator(db, project_id=new_project.id, admin=admin, operator_id=op.id)
    assignment_service.admin_assign_member_to_operator(
        db,
        project_id=new_project.id,
        admin=admin,
        member_id=member.id,
        operator_id=op.id,
    )
    db.commit()

    ma = db.query(MemberAssignment).filter_by(project_id=new_project.id, member_id=member.id, is_active=True).first()
    assert ma is not None
    assert ma.operator_id == op.id


def test_terminated_operator_can_send_help_note_in_admin_conversation(db: Session):
    admin = _user(db, "admin_help@t.com", UserRole.ADMIN)
    op = _user(db, "op_help@t.com", UserRole.OPERATOR)
    p = _project(db, "Help Project")

    _membership(db, p.id, admin.id, UserRole.ADMIN)
    _membership(db, p.id, op.id, UserRole.OPERATOR)
    _operator_assignment(db, p.id, admin.id, op.id)
    db.commit()

    assignment_service.terminate_user_in_project(db, project_id=p.id, user_id=op.id)
    db.commit()

    conv = conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=p.id,
        admin_id=admin.id,
        operator_id=op.id,
    )

    msg = conversation_service.create_message(
        db,
        project_id=p.id,
        conversation_id=conv.id,
        sender=op,
        content="Please help restore my access",
        conversation=conv,
        message_type=MessageType.TEXT,
    )
    db.commit()

    assert msg.id is not None
    assert msg.conversation_id == conv.id


def test_terminated_operator_cannot_message_member_conversation(db: Session):
    admin = _user(db, "admin_help2@t.com", UserRole.ADMIN)
    op = _user(db, "op_help2@t.com", UserRole.OPERATOR)
    member = _user(db, "member_help2@t.com", UserRole.MEMBER)
    p = _project(db, "Help Project 2")

    _membership(db, p.id, admin.id, UserRole.ADMIN)
    _membership(db, p.id, op.id, UserRole.OPERATOR)
    _membership(db, p.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, p.id, admin.id, op.id)
    _member_assignment(db, p.id, op.id, member.id)
    db.commit()

    conv = conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=p.id,
        operator_id=op.id,
        member_id=member.id,
    )
    assignment_service.terminate_user_in_project(db, project_id=p.id, user_id=op.id)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        conversation_service.create_message(
            db,
            project_id=p.id,
            conversation_id=conv.id,
            sender=op,
            content="This must fail",
            conversation=conv,
            message_type=MessageType.TEXT,
        )
    assert exc.value.status_code == 403


def test_removed_operator_disappears_from_visible_project_and_member_conversations(db: Session):
    admin = _user(db, "admin_removed_op@t.com", UserRole.ADMIN)
    op = _user(db, "op_removed_op@t.com", UserRole.OPERATOR)
    member = _user(db, "member_removed_op@t.com", UserRole.MEMBER)
    project = _project(db, "Removed Operator Project")

    _membership(db, project.id, admin.id, UserRole.ADMIN)
    _membership(db, project.id, op.id, UserRole.OPERATOR)
    _membership(db, project.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, project.id, admin.id, op.id)
    _member_assignment(db, project.id, op.id, member.id)
    db.flush()

    conv = conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project.id,
        operator_id=op.id,
        member_id=member.id,
    )
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=member,
        content="hello before removal",
        conversation=conv,
    )
    db.commit()

    assignment_service.admin_remove_operator(db, project_id=project.id, operator_id=op.id, terminate=False)
    db.commit()

    operator_projects = project_service.list_projects_for_user(db, op)
    member_conversations = conversation_service.list_conversations(db, project_id=project.id, user=member)
    member_assignment = db.query(MemberAssignment).filter_by(project_id=project.id, member_id=member.id).first()

    assert operator_projects == []
    assert member_conversations == []
    assert member_assignment is not None
    assert member_assignment.is_active is False


def test_removed_member_disappears_from_project_and_operator_inbox(db: Session):
    admin = _user(db, "admin_removed_member@t.com", UserRole.ADMIN)
    op = _user(db, "op_removed_member@t.com", UserRole.OPERATOR)
    member = _user(db, "member_removed_member@t.com", UserRole.MEMBER)
    project = _project(db, "Removed Member Project")

    _membership(db, project.id, admin.id, UserRole.ADMIN)
    _membership(db, project.id, op.id, UserRole.OPERATOR)
    _membership(db, project.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, project.id, admin.id, op.id)
    _member_assignment(db, project.id, op.id, member.id)
    db.flush()

    conv = conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project.id,
        operator_id=op.id,
        member_id=member.id,
    )
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=op,
        content="hello before member removal",
        conversation=conv,
    )
    db.commit()

    assignment_service.admin_remove_member_from_project(
        db,
        project_id=project.id,
        admin=admin,
        member_id=member.id,
        terminate=False,
    )
    db.commit()

    member_projects = project_service.list_projects_for_user(db, member)
    operator_conversations = conversation_service.list_conversations(db, project_id=project.id, user=op)
    membership = db.query(ProjectUser).filter_by(project_id=project.id, user_id=member.id).first()

    assert member_projects == []
    assert all(conversation.member_id != member.id for conversation in operator_conversations)
    assert membership is not None
    assert membership.status == MembershipStatus.REMOVED


def test_terminated_operator_only_sees_admin_help_conversation(db: Session):
    admin = _user(db, "admin_terminated_view@t.com", UserRole.ADMIN)
    op = _user(db, "op_terminated_view@t.com", UserRole.OPERATOR)
    member = _user(db, "member_terminated_view@t.com", UserRole.MEMBER)
    project = _project(db, "Terminated Operator View Project")

    _membership(db, project.id, admin.id, UserRole.ADMIN)
    _membership(db, project.id, op.id, UserRole.OPERATOR)
    _membership(db, project.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, project.id, admin.id, op.id)
    _member_assignment(db, project.id, op.id, member.id)
    db.flush()

    admin_conv = conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=project.id,
        admin_id=admin.id,
        operator_id=op.id,
    )
    member_conv = conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project.id,
        operator_id=op.id,
        member_id=member.id,
    )
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=admin_conv.id,
        sender=admin,
        content="help channel",
        conversation=admin_conv,
    )
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=member_conv.id,
        sender=member,
        content="member channel",
        conversation=member_conv,
    )
    db.commit()

    assignment_service.terminate_user_in_project(db, project_id=project.id, user_id=op.id)
    db.commit()

    operator_conversations = conversation_service.list_conversations(db, project_id=project.id, user=op)

    assert [conversation.id for conversation in operator_conversations] == [admin_conv.id]


def test_terminated_member_keeps_project_visibility_but_loses_conversation_list(db: Session):
    admin = _user(db, "admin_term_member@t.com", UserRole.ADMIN)
    op = _user(db, "op_term_member@t.com", UserRole.OPERATOR)
    member = _user(db, "member_term_member@t.com", UserRole.MEMBER)
    project = _project(db, "Terminated Member Project")

    _membership(db, project.id, admin.id, UserRole.ADMIN)
    _membership(db, project.id, op.id, UserRole.OPERATOR)
    _membership(db, project.id, member.id, UserRole.MEMBER)
    _operator_assignment(db, project.id, admin.id, op.id)
    _member_assignment(db, project.id, op.id, member.id)
    db.flush()

    member_conv = conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project.id,
        operator_id=op.id,
        member_id=member.id,
    )
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=member_conv.id,
        sender=op,
        content="message before termination",
        conversation=member_conv,
    )
    db.commit()

    assignment_service.terminate_user_in_project(db, project_id=project.id, user_id=member.id)
    db.commit()

    member_projects = project_service.list_projects_for_user(db, member)
    member_conversations = conversation_service.list_conversations(db, project_id=project.id, user=member)
    membership = db.query(ProjectUser).filter_by(project_id=project.id, user_id=member.id).first()

    assert [project_row.id for project_row in member_projects] == [project.id]
    assert member_conversations == []
    assert membership is not None
    assert membership.status == MembershipStatus.TERMINATED
