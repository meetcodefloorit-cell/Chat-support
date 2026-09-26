from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.models import (
    Conversation,
    ConversationHidden,
    ConversationType,
    MemberAssignment,
    MembershipStatus,
    Message,
    Notification,
    OperatorAssignment,
    Project,
    ProjectUser,
    User,
    UserRole,
)
from app.services import conversation_service


def _user(email: str, role: UserRole) -> User:
    return User(email=email, name=email.split("@")[0], password_hash="x", role=role, is_active=True)


def _add_membership(db, project_id: int, user_id: int, role: UserRole) -> None:
    db.add(
        ProjectUser(
            project_id=project_id,
            user_id=user_id,
            role_override=role,
            status=MembershipStatus.ACTIVE,
        )
    )


def _setup_admin_operator(db):
    admin = _user("admin@test.com", UserRole.ADMIN)
    operator = _user("operator@test.com", UserRole.OPERATOR)
    db.add_all([admin, operator])
    db.flush()

    project = Project(name="Demo", logo_url=None, is_active=True)
    db.add(project)
    db.flush()

    _add_membership(db, project.id, admin.id, UserRole.ADMIN)
    _add_membership(db, project.id, operator.id, UserRole.OPERATOR)
    db.add(OperatorAssignment(project_id=project.id, admin_id=admin.id, operator_id=operator.id, is_active=True))
    db.commit()
    return project, admin, operator


def test_admin_delete_for_me_clears_only_admin_history(db):
    project, admin, operator = _setup_admin_operator(db)

    conv = conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=project.id,
        admin_id=admin.id,
        operator_id=operator.id,
    )
    db.flush()
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=operator,
        content="hello admin",
        conversation=conv,
    )
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=admin,
        content="hello operator",
        conversation=conv,
    )
    db.commit()

    assert any(c.id == conv.id for c in conversation_service.list_conversations(db, project_id=project.id, user=admin))
    assert len(conversation_service.list_messages(db, project_id=project.id, conversation_id=conv.id, user=admin)) == 2

    conversation_service.delete_conversation(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        admin=admin,
        scope="me",
    )
    db.commit()

    assert any(c.id == conv.id for c in conversation_service.list_conversations(db, project_id=project.id, user=admin))
    assert len(conversation_service.list_messages(db, project_id=project.id, conversation_id=conv.id, user=admin)) == 0
    assert len(conversation_service.list_messages(db, project_id=project.id, conversation_id=conv.id, user=operator)) == 2


def test_admin_delete_for_all_clears_messages_but_keeps_admin_operator_conversation(db):
    project, admin, operator = _setup_admin_operator(db)

    conv = conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=project.id,
        admin_id=admin.id,
        operator_id=operator.id,
    )
    db.flush()
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=operator,
        content="msg one",
        conversation=conv,
    )
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=admin,
        content="msg two",
        conversation=conv,
    )
    db.add(
        Notification(
            project_id=project.id,
            user_id=operator.id,
            kind="new_message",
            title="n",
            reference_id=conv.id,
        )
    )
    conversation_service.delete_conversation(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        admin=admin,
        scope="me",
    )
    db.commit()
    assert db.query(ConversationHidden).filter_by(conversation_id=conv.id, user_id=admin.id).count() == 1

    conversation_service.delete_conversation(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        admin=admin,
        scope="all",
    )
    db.commit()

    assert db.query(Conversation).filter_by(id=conv.id).one_or_none() is not None
    assert db.query(Message).filter_by(conversation_id=conv.id, project_id=project.id).count() == 0
    assert db.query(Notification).filter_by(project_id=project.id, reference_id=conv.id).count() == 0
    assert db.query(ConversationHidden).filter_by(conversation_id=conv.id).count() == 0
    assert db.query(OperatorAssignment).filter_by(project_id=project.id, operator_id=operator.id, is_active=True).count() == 1

    assert len(conversation_service.list_messages(db, project_id=project.id, conversation_id=conv.id, user=admin)) == 0
    assert len(conversation_service.list_messages(db, project_id=project.id, conversation_id=conv.id, user=operator)) == 0


def test_admin_delete_rejects_non_admin_operator_conversation(db):
    project, admin, operator = _setup_admin_operator(db)
    member = _user("member@test.com", UserRole.MEMBER)
    db.add(member)
    db.flush()

    _add_membership(db, project.id, member.id, UserRole.MEMBER)
    db.add(MemberAssignment(project_id=project.id, operator_id=operator.id, member_id=member.id, is_active=True))
    db.commit()

    conv = conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project.id,
        operator_id=operator.id,
        member_id=member.id,
    )
    db.commit()

    with pytest.raises(HTTPException) as exc:
        conversation_service.delete_conversation(
            db,
            project_id=project.id,
            conversation_id=conv.id,
            admin=admin,
            scope="me",
        )
    assert exc.value.status_code == 400

    assert db.query(Conversation).filter_by(id=conv.id, type=ConversationType.OPERATOR_MEMBER).one_or_none() is not None


def test_admin_delete_for_all_clears_operator_member_conversation(db):
    project, admin, operator = _setup_admin_operator(db)
    member = _user("member_om@test.com", UserRole.MEMBER)
    db.add(member)
    db.flush()

    _add_membership(db, project.id, member.id, UserRole.MEMBER)
    db.add(MemberAssignment(project_id=project.id, operator_id=operator.id, member_id=member.id, is_active=True))
    db.commit()

    conv = conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project.id,
        operator_id=operator.id,
        member_id=member.id,
    )
    db.flush()
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=member,
        content="hello operator",
        conversation=conv,
    )
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=operator,
        content="hello member",
        conversation=conv,
    )
    db.add(
        Notification(
            project_id=project.id,
            user_id=member.id,
            kind="new_message",
            title="n",
            reference_id=conv.id,
        )
    )
    db.commit()

    conversation_service.delete_conversation(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        admin=admin,
        scope="all",
    )
    db.commit()

    assert db.query(Conversation).filter_by(id=conv.id, type=ConversationType.OPERATOR_MEMBER).one_or_none() is not None
    assert db.query(Message).filter_by(conversation_id=conv.id, project_id=project.id).count() == 0
    assert db.query(Notification).filter_by(project_id=project.id, reference_id=conv.id).count() == 0
    assert conversation_service.get_clear_event_targets(
        db,
        project_id=project.id,
        conversation=conv,
        scope="all",
        requester_admin_id=admin.id,
    ) == {admin.id, operator.id, member.id}


def test_admin_bulk_delete_clears_multiple_conversations_and_keeps_shells(db):
    project, admin, operator = _setup_admin_operator(db)
    member = _user("member_bulk@test.com", UserRole.MEMBER)
    db.add(member)
    db.flush()

    _add_membership(db, project.id, member.id, UserRole.MEMBER)
    db.add(MemberAssignment(project_id=project.id, operator_id=operator.id, member_id=member.id, is_active=True))
    db.commit()

    admin_conv = conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=project.id,
        admin_id=admin.id,
        operator_id=operator.id,
    )
    member_conv = conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project.id,
        operator_id=operator.id,
        member_id=member.id,
    )
    db.flush()

    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=admin_conv.id,
        sender=operator,
        content="admin thread",
        conversation=admin_conv,
    )
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=member_conv.id,
        sender=member,
        content="member thread",
        conversation=member_conv,
    )
    db.add_all(
        [
            Notification(project_id=project.id, user_id=operator.id, kind="new_message", title="a", reference_id=admin_conv.id),
            Notification(project_id=project.id, user_id=member.id, kind="new_message", title="b", reference_id=member_conv.id),
        ]
    )
    db.commit()

    cleared = conversation_service.delete_conversations_bulk(
        db,
        project_id=project.id,
        conversation_ids=[admin_conv.id, member_conv.id, admin_conv.id],
        admin=admin,
    )
    db.commit()

    assert {conv.id for conv in cleared} == {admin_conv.id, member_conv.id}
    assert db.query(Conversation).filter_by(id=admin_conv.id).one_or_none() is not None
    assert db.query(Conversation).filter_by(id=member_conv.id).one_or_none() is not None
    assert db.query(Message).filter_by(conversation_id=admin_conv.id, project_id=project.id).count() == 0
    assert db.query(Message).filter_by(conversation_id=member_conv.id, project_id=project.id).count() == 0
    assert db.query(Notification).filter_by(project_id=project.id, reference_id=admin_conv.id).count() == 0
    assert db.query(Notification).filter_by(project_id=project.id, reference_id=member_conv.id).count() == 0


def test_admin_bulk_hide_hides_member_threads_for_admin_only(db):
    project, admin, operator = _setup_admin_operator(db)
    member = _user("member_hide@test.com", UserRole.MEMBER)
    db.add(member)
    db.flush()

    _add_membership(db, project.id, member.id, UserRole.MEMBER)
    db.add(MemberAssignment(project_id=project.id, operator_id=operator.id, member_id=member.id, is_active=True))
    db.commit()

    admin_conv = conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=project.id,
        admin_id=admin.id,
        operator_id=operator.id,
    )
    member_conv = conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project.id,
        operator_id=operator.id,
        member_id=member.id,
    )
    db.flush()
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=member_conv.id,
        sender=member,
        content="member hello",
        conversation=member_conv,
    )
    db.commit()

    hidden = conversation_service.hide_conversations_for_admin_bulk(
        db,
        project_id=project.id,
        conversation_ids=[member_conv.id, member_conv.id],
        admin=admin,
    )
    db.commit()

    assert {conv.id for conv in hidden} == {member_conv.id}
    admin_conversation_ids = {c.id for c in conversation_service.list_conversations(db, project_id=project.id, user=admin)}
    operator_conversation_ids = {c.id for c in conversation_service.list_conversations(db, project_id=project.id, user=operator)}
    member_conversation_ids = {c.id for c in conversation_service.list_conversations(db, project_id=project.id, user=member)}

    assert member_conv.id not in admin_conversation_ids
    assert admin_conv.id in admin_conversation_ids
    assert member_conv.id in operator_conversation_ids
    assert member_conv.id in member_conversation_ids
    assert len(conversation_service.list_messages(db, project_id=project.id, conversation_id=member_conv.id, user=operator)) == 1


def test_admin_bulk_hide_rejects_non_member_conversations(db):
    project, admin, operator = _setup_admin_operator(db)
    admin_conv = conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=project.id,
        admin_id=admin.id,
        operator_id=operator.id,
    )
    db.commit()

    with pytest.raises(HTTPException) as exc:
        conversation_service.hide_conversations_for_admin_bulk(
            db,
            project_id=project.id,
            conversation_ids=[admin_conv.id],
            admin=admin,
        )
    assert exc.value.status_code == 400


def test_admin_unread_and_last_message_respect_clear_cutoff(db):
    project, admin, operator = _setup_admin_operator(db)
    conv = conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=project.id,
        admin_id=admin.id,
        operator_id=operator.id,
    )
    db.flush()
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=operator,
        content="old message",
        conversation=conv,
    )
    db.flush()
    conversation_service.delete_conversation(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        admin=admin,
        scope="me",
    )
    db.flush()
    new_message = conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=operator,
        content="new message",
        conversation=conv,
    )
    db.commit()

    visible_messages = conversation_service.list_messages(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        user=admin,
    )
    assert [m.id for m in visible_messages] == [new_message.id]

    unread = conversation_service.get_unread_count(
        db,
        conversation_id=conv.id,
        user_id=admin.id,
        project_id=project.id,
    )
    assert unread == 1

    last_message_at = conversation_service.get_last_message_time(
        db,
        conversation_id=conv.id,
        user_id=admin.id,
        project_id=project.id,
    )
    assert last_message_at is not None
    assert last_message_at == new_message.created_at.replace(tzinfo=None)


def test_get_conversation_stats_batches_unread_and_last_message(db):
    project, admin, operator = _setup_admin_operator(db)
    member = _user("member_stats@test.com", UserRole.MEMBER)
    db.add(member)
    db.flush()

    _add_membership(db, project.id, member.id, UserRole.MEMBER)
    db.add(MemberAssignment(project_id=project.id, operator_id=operator.id, member_id=member.id, is_active=True))
    db.flush()

    admin_conv = conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=project.id,
        admin_id=admin.id,
        operator_id=operator.id,
    )
    member_conv = conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project.id,
        operator_id=operator.id,
        member_id=member.id,
    )
    db.flush()

    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=admin_conv.id,
        sender=operator,
        content="old admin message",
        conversation=admin_conv,
    )
    db.flush()
    conversation_service.delete_conversation(
        db,
        project_id=project.id,
        conversation_id=admin_conv.id,
        admin=admin,
        scope="me",
    )
    db.flush()
    admin_new_message = conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=admin_conv.id,
        sender=operator,
        content="new admin message",
        conversation=admin_conv,
    )
    member_message = conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=member_conv.id,
        sender=member,
        content="member hello",
        conversation=member_conv,
    )
    db.commit()

    stats = conversation_service.get_conversation_stats(
        db,
        project_id=project.id,
        user_id=admin.id,
        conversations=[admin_conv, member_conv],
    )

    assert stats[admin_conv.id]["unread_count"] == 1
    assert stats[admin_conv.id]["last_message_at"] == admin_new_message.created_at.replace(tzinfo=None)
    assert stats[member_conv.id]["unread_count"] == 1
    assert stats[member_conv.id]["last_message_at"] == member_message.created_at.replace(tzinfo=None)


def test_shared_admin_operator_conversation_allows_other_project_admin_to_send(db):
    project, admin_a, operator = _setup_admin_operator(db)
    admin_b = _user("admin_b@test.com", UserRole.ADMIN)
    db.add(admin_b)
    db.flush()
    _add_membership(db, project.id, admin_b.id, UserRole.ADMIN)
    db.commit()

    conv = conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=project.id,
        admin_id=admin_a.id,
        operator_id=operator.id,
    )
    db.flush()
    msg = conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=conv.id,
        sender=admin_b,
        content="admin b ping",
        conversation=conv,
    )
    db.commit()

    assert msg.conversation_id == conv.id
    recipients = conversation_service.get_message_recipients(
        db,
        project_id=project.id,
        conversation_id=conv.id,
    )
    assert {admin_a.id, admin_b.id, operator.id}.issubset(recipients)


def test_merge_duplicate_admin_operator_conversations_preserves_history(db):
    admin_a = _user("admin_merge_a@test.com", UserRole.ADMIN)
    admin_b = _user("admin_merge_b@test.com", UserRole.ADMIN)
    operator = _user("operator_merge@test.com", UserRole.OPERATOR)
    db.add_all([admin_a, admin_b, operator])
    db.flush()

    project = Project(name="Merge Demo", logo_url=None, is_active=True)
    db.add(project)
    db.flush()

    _add_membership(db, project.id, admin_a.id, UserRole.ADMIN)
    _add_membership(db, project.id, admin_b.id, UserRole.ADMIN)
    _add_membership(db, project.id, operator.id, UserRole.OPERATOR)
    db.add(OperatorAssignment(project_id=project.id, admin_id=admin_a.id, operator_id=operator.id, is_active=True))
    db.flush()

    canonical = Conversation(
        project_id=project.id,
        type=ConversationType.ADMIN_OPERATOR,
        operator_id=operator.id,
        admin_id=admin_a.id,
        member_id=None,
        name="",
    )
    duplicate = Conversation(
        project_id=project.id,
        type=ConversationType.ADMIN_OPERATOR,
        operator_id=operator.id,
        admin_id=admin_b.id,
        member_id=None,
        name="",
    )
    db.add_all([canonical, duplicate])
    db.flush()

    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=canonical.id,
        sender=operator,
        content="old canonical",
        conversation=canonical,
    )
    conversation_service.create_message(
        db,
        project_id=project.id,
        conversation_id=duplicate.id,
        sender=operator,
        content="old duplicate",
        conversation=duplicate,
    )
    db.flush()

    db.add(
        Notification(
            project_id=project.id,
            user_id=operator.id,
            kind="new_message",
            title="dup notif",
            reference_id=duplicate.id,
        )
    )
    old_hidden = datetime.now(timezone.utc) - timedelta(minutes=10)
    new_hidden = datetime.now(timezone.utc)
    db.add(
        ConversationHidden(
            project_id=project.id,
            conversation_id=canonical.id,
            user_id=admin_a.id,
            hidden_at=old_hidden,
        )
    )
    db.add(
        ConversationHidden(
            project_id=project.id,
            conversation_id=duplicate.id,
            user_id=admin_a.id,
            hidden_at=new_hidden,
        )
    )
    db.commit()

    merged = conversation_service.merge_duplicate_admin_operator_conversations(db, project_id=project.id)
    db.commit()

    assert merged == 1
    threads = db.query(Conversation).filter_by(project_id=project.id, type=ConversationType.ADMIN_OPERATOR).all()
    assert len(threads) == 1
    merged_thread_id = threads[0].id

    moved_messages = db.query(Message).filter_by(project_id=project.id, conversation_id=merged_thread_id).all()
    assert len(moved_messages) == 2

    moved_notifications = db.query(Notification).filter_by(project_id=project.id, reference_id=merged_thread_id).all()
    assert len(moved_notifications) == 1

    hidden_rows = db.query(ConversationHidden).filter_by(project_id=project.id, conversation_id=merged_thread_id, user_id=admin_a.id).all()
    assert len(hidden_rows) == 1
    assert hidden_rows[0].hidden_at.replace(tzinfo=None) == new_hidden.replace(tzinfo=None)
