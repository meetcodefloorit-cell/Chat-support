"""
Server-authoritative chat timing / SLA / auto-close / operator-mistake tests.

These construct sessions with explicit, controlled timestamps (never real sleeps) so the
suite runs instantly while still exercising the exact 60s / 180s boundaries.
"""

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
import pytest

from app.models import (
    ChatSessionStatus,
    MemberAssignment,
    MembershipStatus,
    OperatorAssignment,
    OperatorMistake,
    OperatorMistakeType,
    Project,
    ProjectUser,
    User,
    UserRole,
)
from app.services import chat_session_service, conversation_service


def _user(email: str, role: UserRole) -> User:
    return User(email=email, name=email.split("@")[0], password_hash="x", role=role, is_active=True)


def _setup(db):
    admin = _user("admin@t.com", UserRole.ADMIN)
    operator = _user("op@t.com", UserRole.OPERATOR)
    member = _user("member@t.com", UserRole.MEMBER)
    db.add_all([admin, operator, member])
    db.flush()

    project = Project(name="Demo", is_active=True)
    db.add(project)
    db.flush()

    for user, role in [(admin, UserRole.ADMIN), (operator, UserRole.OPERATOR), (member, UserRole.MEMBER)]:
        db.add(ProjectUser(project_id=project.id, user_id=user.id, role_override=role, status=MembershipStatus.ACTIVE))
    db.add_all(
        [
            OperatorAssignment(project_id=project.id, admin_id=admin.id, operator_id=operator.id, is_active=True),
            MemberAssignment(project_id=project.id, operator_id=operator.id, member_id=member.id, is_active=True),
        ]
    )
    db.commit()

    conv = conversation_service.get_or_create_operator_member_conversation(
        db, project_id=project.id, operator_id=operator.id, member_id=member.id
    )
    db.commit()
    return project, operator, member, conv


# ---------------------------------------------------------------------------
# First-response SLA (1 minute)
# ---------------------------------------------------------------------------


def test_sla_met_when_operator_responds_within_60_seconds(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)

    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    chat_session_service.record_operator_response(db, conversation=conv, now=t0 + timedelta(seconds=30))
    db.commit()
    db.refresh(session)

    assert session.first_response_sla_met is True
    assert db.query(OperatorMistake).filter_by(session_id=session.id).count() == 0


def test_sla_met_at_59_seconds_boundary(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    chat_session_service.record_operator_response(db, conversation=conv, now=t0 + timedelta(seconds=59))
    db.commit()
    db.refresh(session)

    assert session.first_response_sla_met is True


def test_sla_breach_at_61_seconds(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    chat_session_service.record_operator_response(db, conversation=conv, now=t0 + timedelta(seconds=61))
    db.commit()
    db.refresh(session)

    assert session.first_response_sla_met is False
    mistakes = db.query(OperatorMistake).filter_by(session_id=session.id).all()
    assert len(mistakes) == 1
    assert mistakes[0].mistake_type == OperatorMistakeType.FIRST_RESPONSE_SLA_BREACH
    # A late response still counts as the operator's first response -- the session itself
    # is not force-closed just because the SLA was missed.
    assert session.status == ChatSessionStatus.ACTIVE


def test_exact_60_second_boundary_meets_sla(db):
    """response == deadline exactly -> MET (spec: 60.000s is the deadline, not yet a breach)."""
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    chat_session_service.record_operator_response(db, conversation=conv, now=t0 + timedelta(seconds=60))
    db.commit()
    db.refresh(session)

    assert session.first_response_sla_met is True


def test_operator_never_responds_sweep_marks_missed(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    # Simulate 60+ seconds having elapsed with no operator reply.
    breached = chat_session_service.sweep_sla_breaches(db, now=t0 + timedelta(seconds=61))
    db.commit()

    assert len(breached) == 1
    db.refresh(session)
    assert session.first_response_sla_met is False
    assert session.status == ChatSessionStatus.ACTIVE  # SLA breach alone does not end the session
    mistakes = db.query(OperatorMistake).filter_by(session_id=session.id).all()
    assert len(mistakes) == 1
    assert mistakes[0].mistake_type == OperatorMistakeType.FIRST_RESPONSE_SLA_BREACH


def test_sweep_is_idempotent_no_duplicate_mistakes(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    chat_session_service.sweep_sla_breaches(db, now=t0 + timedelta(seconds=61))
    db.commit()
    chat_session_service.sweep_sla_breaches(db, now=t0 + timedelta(seconds=90))
    db.commit()

    assert db.query(OperatorMistake).filter_by(mistake_type=OperatorMistakeType.FIRST_RESPONSE_SLA_BREACH).count() == 1


# ---------------------------------------------------------------------------
# Thank-you validation (operator-only, case-insensitive)
# ---------------------------------------------------------------------------


def test_thank_you_only_counts_from_operator_never_from_customer(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    conversation_service.create_message(db, project_id=conv.project_id, conversation_id=conv.id, sender=member, content="Thank you", conversation=conv)
    conversation_service.create_message(db, project_id=conv.project_id, conversation_id=conv.id, sender=operator, content="Okay, your issue has been resolved.", conversation=conv)
    db.commit()

    assert chat_session_service.compute_thank_you_present(db, session) is False


def test_thank_you_case_insensitive_variants(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    for phrase in ["THANK YOU", "Thank You!", "thank you for reaching out.", "Thank you for your time."]:
        assert chat_session_service.is_thank_you(phrase) is True
    for phrase in ["Thanks", "your request has been completed.", ""]:
        assert chat_session_service.is_thank_you(phrase) is False


def test_final_operator_message_governs_thank_you_not_earlier_ones(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    # Explicit, strictly-increasing timestamps: Windows' clock resolution can otherwise
    # give two back-to-back now_utc() calls the identical value, making ordering a coin flip.
    m1 = conversation_service.create_message(db, project_id=conv.project_id, conversation_id=conv.id, sender=member, content="Hello", conversation=conv)
    m1.created_at = t0 + timedelta(seconds=1)
    m2 = conversation_service.create_message(db, project_id=conv.project_id, conversation_id=conv.id, sender=operator, content="Thank you for contacting us.", conversation=conv)
    m2.created_at = t0 + timedelta(seconds=2)
    m3 = conversation_service.create_message(db, project_id=conv.project_id, conversation_id=conv.id, sender=operator, content="Your issue is resolved.", conversation=conv)
    m3.created_at = t0 + timedelta(seconds=3)
    db.commit()

    # Final operator message has no thank-you, even though an earlier one did.
    assert chat_session_service.compute_thank_you_present(db, session, as_of=t0 + timedelta(seconds=10)) is False


# ---------------------------------------------------------------------------
# Manual close
# ---------------------------------------------------------------------------


def test_manual_close_succeeds_with_valid_thank_you(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    conversation_service.create_message(db, project_id=conv.project_id, conversation_id=conv.id, sender=operator, content="Thank you for contacting us. Have a great day!", conversation=conv)
    db.commit()

    closed = chat_session_service.close_session_manual(db, conversation=conv, now=t0 + timedelta(seconds=20))
    db.commit()

    assert closed.status == ChatSessionStatus.COMPLETED
    assert closed.thank_you_present is True
    assert db.query(OperatorMistake).filter_by(mistake_type=OperatorMistakeType.MISSING_THANK_YOU).count() == 0


def test_manual_close_blocked_without_thank_you(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    conversation_service.create_message(db, project_id=conv.project_id, conversation_id=conv.id, sender=operator, content="Your issue has been resolved.", conversation=conv)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        chat_session_service.close_session_manual(db, conversation=conv, now=t0 + timedelta(seconds=20))
    assert exc.value.status_code == 422
    db.commit()

    db.refresh(session)
    assert session.status == ChatSessionStatus.ACTIVE  # not silently completed
    # No mistake is recorded for a blocked *attempt* -- only for an actual close without one.
    assert db.query(OperatorMistake).filter_by(mistake_type=OperatorMistakeType.MISSING_THANK_YOU).count() == 0


# ---------------------------------------------------------------------------
# 3-minute auto-close
# ---------------------------------------------------------------------------


def test_auto_close_at_3_minutes_with_thank_you_present(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    conversation_service.create_message(db, project_id=conv.project_id, conversation_id=conv.id, sender=operator, content="Thank you for contacting us.", conversation=conv)
    db.commit()

    closed = chat_session_service.sweep_expired_sessions(db, now=t0 + timedelta(seconds=181))
    db.commit()

    assert len(closed) == 1
    assert closed[0].status == ChatSessionStatus.AUTO_CLOSED
    assert closed[0].thank_you_present is True
    assert db.query(OperatorMistake).filter_by(mistake_type=OperatorMistakeType.MISSING_THANK_YOU).count() == 0


def test_auto_close_at_3_minutes_without_thank_you_records_mistake(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    conversation_service.create_message(db, project_id=conv.project_id, conversation_id=conv.id, sender=operator, content="Resolved.", conversation=conv)
    db.commit()

    closed = chat_session_service.sweep_expired_sessions(db, now=t0 + timedelta(seconds=181))
    db.commit()

    assert closed[0].status == ChatSessionStatus.AUTO_CLOSED
    assert closed[0].thank_you_present is False
    mistakes = db.query(OperatorMistake).filter_by(mistake_type=OperatorMistakeType.MISSING_THANK_YOU).all()
    assert len(mistakes) == 1


def test_chat_never_extends_beyond_3_minutes_even_with_recent_activity(db):
    """A message sent moments before the deadline must not push expires_at outward."""
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    original_expiry = session.expires_at
    db.commit()

    conversation_service.create_message(
        db, project_id=conv.project_id, conversation_id=conv.id, sender=operator, content="still here", conversation=conv,
    )
    db.commit()

    refetched = chat_session_service.get_latest_session(db, conversation_id=conv.id)
    assert refetched.expires_at == original_expiry


def test_two_sweeps_only_one_successful_close_no_duplicate_mistakes(db):
    """Race-condition safety: a second sweep pass over an already-closed session is a no-op."""
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    first_pass = chat_session_service.sweep_expired_sessions(db, now=t0 + timedelta(seconds=200))
    db.commit()
    second_pass = chat_session_service.sweep_expired_sessions(db, now=t0 + timedelta(seconds=250))
    db.commit()

    assert len(first_pass) == 1
    assert len(second_pass) == 0  # already closed -- not picked up again
    assert db.query(OperatorMistake).filter_by(mistake_type=OperatorMistakeType.MISSING_THANK_YOU).count() == 1


# ---------------------------------------------------------------------------
# Abandonment vs missed
# ---------------------------------------------------------------------------


def test_customer_disconnect_marks_abandoned_not_missed(db):
    project, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    abandoned = chat_session_service.abandon_active_sessions_for_member(
        db, project_id=project.id, member_id=member.id, now=t0 + timedelta(seconds=35)
    )
    db.commit()

    assert len(abandoned) == 1
    db.refresh(session)
    assert session.status == ChatSessionStatus.ABANDONED
    # Abandonment is a customer-side event -- it must not itself create an operator mistake.
    assert db.query(OperatorMistake).filter_by(session_id=session.id).count() == 0


def test_missed_and_abandoned_are_distinct_when_both_conditions_present(db):
    """Operator missed the 1-min SLA AND the customer later disconnects: both facts are
    recorded (a FIRST_RESPONSE_SLA_BREACH mistake plus an ABANDONED status), never merged
    or randomly chosen."""
    project, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    session = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()

    chat_session_service.sweep_sla_breaches(db, now=t0 + timedelta(seconds=61))
    db.commit()

    chat_session_service.abandon_active_sessions_for_member(
        db, project_id=project.id, member_id=member.id, now=t0 + timedelta(seconds=90)
    )
    db.commit()

    db.refresh(session)
    assert session.first_response_sla_met is False
    assert session.status == ChatSessionStatus.ABANDONED
    assert db.query(OperatorMistake).filter_by(
        session_id=session.id, mistake_type=OperatorMistakeType.FIRST_RESPONSE_SLA_BREACH
    ).count() == 1


# ---------------------------------------------------------------------------
# New session boundaries
# ---------------------------------------------------------------------------


def test_next_customer_message_opens_a_new_session_after_previous_closed(db):
    _, operator, member, conv = _setup(db)
    t0 = datetime.now(timezone.utc)
    first = chat_session_service.ensure_active_session(db, conversation=conv, now=t0)
    db.commit()
    chat_session_service.sweep_expired_sessions(db, now=t0 + timedelta(seconds=200))
    db.commit()

    second = chat_session_service.ensure_active_session(db, conversation=conv, now=t0 + timedelta(seconds=300))
    db.commit()

    assert second.id != first.id
    assert second.status == ChatSessionStatus.ACTIVE


def test_operator_message_with_no_open_session_is_untracked_not_rejected(db):
    """Per product decision: operator may still message freely between sessions; it is
    simply not attributed to any SLA/timer."""
    _, operator, member, conv = _setup(db)
    # No customer message has ever been sent -> no session exists yet.
    msg = conversation_service.create_message(
        db, project_id=conv.project_id, conversation_id=conv.id, sender=operator, content="Just checking in", conversation=conv,
    )
    db.commit()

    assert msg.id is not None
    assert chat_session_service.get_latest_session(db, conversation_id=conv.id) is None
