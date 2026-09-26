"""
Server-authoritative chat timing / SLA / auto-close / operator-mistake system.

A ChatSession is a bounded customer<->operator interaction window nested inside a
(permanent) operator_member Conversation thread. The thread itself never expires --
only the session does. A session opens on the first customer message since the
previous session ended, runs its own 3-minute max-duration and 1-minute first-response
SLA, and is closed exclusively by this module (never directly by callers).

All timing decisions are made from server timestamps (`now_utc()`); nothing here ever
trusts a client-supplied timestamp, duration, or status.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, aliased

from app.core.config import settings
from app.models import (
    ChatSession,
    ChatSessionEvent,
    ChatSessionEventType,
    ChatSessionStatus,
    Conversation,
    ConversationType,
    Message,
    OperatorMistake,
    OperatorMistakeType,
    Project,
    User,
    UserRole,
)

TERMINAL_STATUSES = {ChatSessionStatus.COMPLETED, ChatSessionStatus.AUTO_CLOSED, ChatSessionStatus.ABANDONED}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _coerce_utc(dt: datetime) -> datetime:
    """Defensive normalization for datetimes read back from the DB. Some SQL dialects
    (notably SQLite's FOR UPDATE path, used only in tests -- production runs Postgres,
    which preserves tzinfo correctly) can drop tzinfo on read; treat a naive value as UTC
    rather than let arithmetic against a tz-aware `now` raise."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def is_thank_you(content: str | None) -> bool:
    if not content:
        return False
    lowered = content.lower()
    return any(phrase in lowered for phrase in settings.thank_you_phrases_list)


def _log_event(db: Session, *, session_id: int, event_type: ChatSessionEventType, detail: str | None = None) -> None:
    db.add(ChatSessionEvent(session_id=session_id, event_type=event_type, detail=detail))


def _record_mistake(
    db: Session,
    *,
    session: ChatSession,
    mistake_type: OperatorMistakeType,
    duration_seconds: int | None,
    reason: str | None,
) -> None:
    db.add(
        OperatorMistake(
            session_id=session.id,
            conversation_id=session.conversation_id,
            project_id=session.project_id,
            operator_id=session.operator_id,
            mistake_type=mistake_type,
            duration_seconds=duration_seconds,
            reason=reason,
        )
    )


def compute_thank_you_present(db: Session, session: ChatSession, *, as_of: datetime | None = None) -> bool:
    """Whether the operator's most recent message in this session's window is a valid thank-you.

    Only ever inspects operator-authored messages -- a customer's "thank you" never counts.
    """
    cutoff = as_of or session.closed_at or now_utc()
    last_operator_message = db.scalar(
        select(Message.content)
        .where(
            Message.conversation_id == session.conversation_id,
            Message.sender_role == UserRole.OPERATOR,
            Message.created_at >= session.started_at,
            Message.created_at <= cutoff,
        )
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    return is_thank_you(last_operator_message)


def _lock_session(db: Session, session_id: int) -> ChatSession | None:
    session = db.scalar(select(ChatSession).where(ChatSession.id == session_id).with_for_update())
    if session is not None:
        session.started_at = _coerce_utc(session.started_at)
        session.expires_at = _coerce_utc(session.expires_at)
        session.first_response_sla_deadline = _coerce_utc(session.first_response_sla_deadline)
        if session.first_response_at is not None:
            session.first_response_at = _coerce_utc(session.first_response_at)
        if session.closed_at is not None:
            session.closed_at = _coerce_utc(session.closed_at)
    return session


def _close_session(
    db: Session,
    *,
    session_id: int,
    new_status: ChatSessionStatus,
    now: datetime,
) -> ChatSession | None:
    """Atomically transition ACTIVE -> a terminal status. Returns None if another
    worker/request already closed it first (safe no-op on races)."""
    session = _lock_session(db, session_id)
    if session is None or session.status != ChatSessionStatus.ACTIVE:
        return None

    thank_you_present = compute_thank_you_present(db, session, as_of=now)

    session.status = new_status
    session.closed_at = now
    session.thank_you_present = thank_you_present

    if thank_you_present:
        _log_event(db, session_id=session.id, event_type=ChatSessionEventType.THANK_YOU_VALIDATED)
    else:
        _log_event(db, session_id=session.id, event_type=ChatSessionEventType.THANK_YOU_MISSING)
        if new_status == ChatSessionStatus.AUTO_CLOSED:
            _record_mistake(
                db,
                session=session,
                mistake_type=OperatorMistakeType.MISSING_THANK_YOU,
                duration_seconds=int((now - session.started_at).total_seconds()),
                reason="Session auto-closed at the 3-minute limit without a valid closing thank-you message.",
            )

    if new_status == ChatSessionStatus.AUTO_CLOSED:
        _log_event(db, session_id=session.id, event_type=ChatSessionEventType.CHAT_AUTO_CLOSED)
    elif new_status == ChatSessionStatus.COMPLETED:
        _log_event(db, session_id=session.id, event_type=ChatSessionEventType.CHAT_COMPLETED)
    elif new_status == ChatSessionStatus.ABANDONED:
        _log_event(db, session_id=session.id, event_type=ChatSessionEventType.CUSTOMER_ABANDONED)

    db.flush()
    return session


def _finalize_if_expired(db: Session, session: ChatSession, now: datetime) -> ChatSession:
    """Self-healing lazy expiry: called on every touch so no request/message ever observes
    or extends a session past its deadline, even if the background sweep hasn't run yet."""
    if session.status == ChatSessionStatus.ACTIVE and now >= session.expires_at:
        closed = _close_session(db, session_id=session.id, new_status=ChatSessionStatus.AUTO_CLOSED, now=session.expires_at)
        return closed or session
    return session


def get_latest_session(db: Session, *, conversation_id: int) -> ChatSession | None:
    session = db.scalar(
        select(ChatSession)
        .where(ChatSession.conversation_id == conversation_id)
        .order_by(ChatSession.started_at.desc())
        .limit(1)
    )
    if session is not None:
        # Defensive: a row read back before its own transaction commits can lose tzinfo
        # under some drivers (harmless -- always UTC already; see _coerce_utc docstring).
        session.expires_at = _coerce_utc(session.expires_at)
        session.first_response_sla_deadline = _coerce_utc(session.first_response_sla_deadline)
        session = _finalize_if_expired(db, session, now_utc())
    return session


def ensure_active_session(db: Session, *, conversation: Conversation, now: datetime) -> ChatSession:
    """Called when a MEMBER message is persisted. Opens a new session if none is active."""
    latest = get_latest_session(db, conversation_id=conversation.id)
    if latest is not None and latest.status == ChatSessionStatus.ACTIVE:
        return latest

    max_duration = timedelta(seconds=settings.chat_max_duration_seconds)
    sla_window = timedelta(seconds=settings.first_response_sla_seconds)
    session = ChatSession(
        conversation_id=conversation.id,
        project_id=conversation.project_id,
        operator_id=conversation.operator_id,
        member_id=conversation.member_id,
        status=ChatSessionStatus.ACTIVE,
        started_at=now,
        expires_at=now + max_duration,
        first_response_sla_deadline=now + sla_window,
    )
    db.add(session)
    db.flush()
    _log_event(db, session_id=session.id, event_type=ChatSessionEventType.SESSION_STARTED)
    return session


def record_operator_response(db: Session, *, conversation: Conversation, now: datetime) -> None:
    """Called when an OPERATOR message is persisted. Only the FIRST operator message in an
    active session counts toward the first-response SLA; later ones are ordinary replies."""
    latest = get_latest_session(db, conversation_id=conversation.id)
    if latest is None or latest.status != ChatSessionStatus.ACTIVE:
        return  # no open session -> free/untracked message, nothing to enforce
    if latest.first_response_at is not None:
        return  # SLA already resolved for this session

    latest.first_response_at = now
    sla_met = now <= latest.first_response_sla_deadline
    latest.first_response_sla_met = sla_met
    _log_event(db, session_id=latest.id, event_type=ChatSessionEventType.OPERATOR_FIRST_RESPONSE)

    if sla_met:
        _log_event(db, session_id=latest.id, event_type=ChatSessionEventType.FIRST_RESPONSE_SLA_MET)
    else:
        _log_event(db, session_id=latest.id, event_type=ChatSessionEventType.FIRST_RESPONSE_SLA_BREACHED)
        _record_mistake(
            db,
            session=latest,
            mistake_type=OperatorMistakeType.FIRST_RESPONSE_SLA_BREACH,
            duration_seconds=int((now - latest.started_at).total_seconds()),
            reason="First operator response arrived after the 1-minute SLA deadline.",
        )
    db.flush()


def sweep_sla_breaches(db: Session, *, now: datetime | None = None) -> list[ChatSession]:
    """Mark ACTIVE sessions whose 1-minute first-response deadline passed with no response yet.
    Does not close the session -- the chat keeps running toward its 3-minute limit."""
    now = now or now_utc()
    candidate_ids = db.scalars(
        select(ChatSession.id).where(
            ChatSession.status == ChatSessionStatus.ACTIVE,
            ChatSession.first_response_at.is_(None),
            ChatSession.first_response_sla_met.is_(None),
            ChatSession.first_response_sla_deadline <= now,
        )
    ).all()
    breached: list[ChatSession] = []
    for session_id in candidate_ids:
        session = _lock_session(db, session_id)
        if session is None or session.status != ChatSessionStatus.ACTIVE:
            continue
        if session.first_response_at is not None or session.first_response_sla_met is not None:
            continue
        session.first_response_sla_met = False
        _log_event(db, session_id=session.id, event_type=ChatSessionEventType.FIRST_RESPONSE_SLA_BREACHED)
        _record_mistake(
            db,
            session=session,
            mistake_type=OperatorMistakeType.FIRST_RESPONSE_SLA_BREACH,
            duration_seconds=settings.first_response_sla_seconds,
            reason="No operator response was sent within the 1-minute SLA window.",
        )
        breached.append(session)
    if breached:
        db.flush()
    return breached


def sweep_expired_sessions(db: Session, *, now: datetime | None = None) -> list[ChatSession]:
    """Auto-close every ACTIVE session whose 3-minute deadline has passed."""
    now = now or now_utc()
    candidate_ids = db.scalars(
        select(ChatSession.id).where(
            ChatSession.status == ChatSessionStatus.ACTIVE,
            ChatSession.expires_at <= now,
        )
    ).all()
    closed: list[ChatSession] = []
    for session_id in candidate_ids:
        session = _close_session(db, session_id=session_id, new_status=ChatSessionStatus.AUTO_CLOSED, now=now)
        if session is not None:
            closed.append(session)
    return closed


def close_session_manual(db: Session, *, conversation: Conversation, now: datetime) -> ChatSession:
    """Operator-initiated close. Rejects (422) if the required thank-you is missing instead
    of silently completing. Never accepts a client-provided status/timestamp."""
    latest = get_latest_session(db, conversation_id=conversation.id)
    if latest is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active chat session for this conversation")
    if latest.status != ChatSessionStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Chat session has already ended ({latest.status.value}).",
        )

    thank_you_present = compute_thank_you_present(db, latest, as_of=now)
    if not thank_you_present:
        _log_event(db, session_id=latest.id, event_type=ChatSessionEventType.CLOSE_ATTEMPT_BLOCKED)
        db.flush()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Please send a final 'Thank you' message before closing the chat.",
        )

    closed = _close_session(db, session_id=latest.id, new_status=ChatSessionStatus.COMPLETED, now=now)
    if closed is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Chat session has already expired.")
    return closed


def abandon_active_sessions_for_member(db: Session, *, project_id: int, member_id: int, now: datetime | None = None) -> list[ChatSession]:
    """Called when a MEMBER's websocket disconnects. Closes any of their currently-active
    sessions as ABANDONED rather than letting them silently auto-close later."""
    now = now or now_utc()
    session_ids = db.scalars(
        select(ChatSession.id)
        .join(Conversation, Conversation.id == ChatSession.conversation_id)
        .where(
            ChatSession.status == ChatSessionStatus.ACTIVE,
            Conversation.type == ConversationType.OPERATOR_MEMBER,
            Conversation.project_id == project_id,
            Conversation.member_id == member_id,
        )
    ).all()
    abandoned: list[ChatSession] = []
    for session_id in session_ids:
        session = _close_session(db, session_id=session_id, new_status=ChatSessionStatus.ABANDONED, now=now)
        if session is not None:
            abandoned.append(session)
    return abandoned


def on_message_persisted(db: Session, *, conversation: Conversation, sender_role: UserRole, created_at: datetime) -> None:
    """Single hook called by conversation_service.create_message right after a message is
    stored. Only operator_member conversations participate in session timing."""
    if conversation.type != ConversationType.OPERATOR_MEMBER:
        return
    if sender_role == UserRole.MEMBER:
        ensure_active_session(db, conversation=conversation, now=created_at)
    elif sender_role == UserRole.OPERATOR:
        record_operator_response(db, conversation=conversation, now=created_at)


def serialize_session(session: ChatSession | None, *, now: datetime | None = None) -> dict:
    now = now or now_utc()
    if session is None:
        return {
            "session_id": None,
            "status": None,
            "started_at": None,
            "expires_at": None,
            "remaining_seconds": None,
            "first_response_sla_deadline": None,
            "first_response_at": None,
            "first_response_sla_met": None,
            "first_response_remaining_seconds": None,
            "thank_you_present": None,
            "closed_at": None,
            "max_duration_seconds": settings.chat_max_duration_seconds,
            "first_response_sla_seconds": settings.first_response_sla_seconds,
        }

    remaining = None
    first_response_remaining = None
    if session.status == ChatSessionStatus.ACTIVE:
        remaining = max(0, int((session.expires_at - now).total_seconds()))
        if session.first_response_at is None:
            first_response_remaining = max(0, int((session.first_response_sla_deadline - now).total_seconds()))

    return {
        "session_id": session.id,
        "status": session.status.value,
        "started_at": session.started_at.isoformat(),
        "expires_at": session.expires_at.isoformat(),
        "remaining_seconds": remaining,
        "first_response_sla_deadline": session.first_response_sla_deadline.isoformat(),
        "first_response_at": session.first_response_at.isoformat() if session.first_response_at else None,
        "first_response_sla_met": session.first_response_sla_met,
        "first_response_remaining_seconds": first_response_remaining,
        "thank_you_present": session.thank_you_present,
        "closed_at": session.closed_at.isoformat() if session.closed_at else None,
        "max_duration_seconds": settings.chat_max_duration_seconds,
        "first_response_sla_seconds": settings.first_response_sla_seconds,
    }


# ---- Timing analytics (sections 20-22) ----
# All figures come from ChatSession/OperatorMistake rows only -- the same authoritative
# source used for live enforcement, so numbers never diverge between pages.

_EMPTY_TIMING_METRICS = {
    "total_sessions": 0,
    "completed": 0,
    "missed": 0,
    "abandoned": 0,
    "auto_closed": 0,
    "sla_met": 0,
    "sla_breached": 0,
    "avg_first_response_seconds": None,
    "avg_handling_seconds": None,
    "missing_thank_you_count": 0,
    "operator_mistake_count": 0,
    "sla_compliance_percent": None,
}


def _timing_metrics_from_rows(
    *,
    total: int,
    completed: int,
    abandoned: int,
    auto_closed: int,
    sla_met: int,
    sla_breached: int,
    avg_first_response: float | None,
    avg_handling: float | None,
    missing_thank_you: int,
    mistake_count: int,
) -> dict:
    resolved_sla = sla_met + sla_breached
    return {
        "total_sessions": total,
        "completed": completed,
        "missed": sla_breached,
        "abandoned": abandoned,
        "auto_closed": auto_closed,
        "sla_met": sla_met,
        "sla_breached": sla_breached,
        "avg_first_response_seconds": avg_first_response,
        "avg_handling_seconds": avg_handling,
        "missing_thank_you_count": missing_thank_you,
        "operator_mistake_count": mistake_count,
        "sla_compliance_percent": round(sla_met / resolved_sla * 100, 1) if resolved_sla > 0 else None,
    }


def get_operator_timing_metrics(
    db: Session, *, operator_id: int, project_id: int | None, start, end
) -> dict:
    conds = [ChatSession.operator_id == operator_id, ChatSession.started_at >= start, ChatSession.started_at <= end]
    if project_id is not None:
        conds.append(ChatSession.project_id == project_id)

    status_counts = dict(
        db.execute(select(ChatSession.status, func.count()).where(*conds).group_by(ChatSession.status)).all()
    )
    total = sum(status_counts.values())
    completed = status_counts.get(ChatSessionStatus.COMPLETED, 0)
    abandoned = status_counts.get(ChatSessionStatus.ABANDONED, 0)
    auto_closed = status_counts.get(ChatSessionStatus.AUTO_CLOSED, 0)

    sla_counts = dict(
        db.execute(
            select(ChatSession.first_response_sla_met, func.count())
            .where(*conds, ChatSession.first_response_sla_met.is_not(None))
            .group_by(ChatSession.first_response_sla_met)
        ).all()
    )
    sla_met = sla_counts.get(True, 0)
    sla_breached = sla_counts.get(False, 0)

    avg_first_response = db.scalar(
        select(func.avg(func.extract("epoch", ChatSession.first_response_at - ChatSession.started_at))).where(
            *conds, ChatSession.first_response_at.is_not(None)
        )
    )
    avg_handling = db.scalar(
        select(func.avg(func.extract("epoch", ChatSession.closed_at - ChatSession.started_at))).where(
            *conds, ChatSession.status == ChatSessionStatus.COMPLETED
        )
    )
    missing_thank_you = db.scalar(select(func.count()).where(*conds, ChatSession.thank_you_present.is_(False))) or 0

    mistake_conds = [
        OperatorMistake.operator_id == operator_id,
        OperatorMistake.occurred_at >= start,
        OperatorMistake.occurred_at <= end,
    ]
    if project_id is not None:
        mistake_conds.append(OperatorMistake.project_id == project_id)
    mistake_count = db.scalar(select(func.count()).where(*mistake_conds)) or 0

    return _timing_metrics_from_rows(
        total=total,
        completed=completed,
        abandoned=abandoned,
        auto_closed=auto_closed,
        sla_met=sla_met,
        sla_breached=sla_breached,
        avg_first_response=float(avg_first_response) if avg_first_response is not None else None,
        avg_handling=float(avg_handling) if avg_handling is not None else None,
        missing_thank_you=int(missing_thank_you),
        mistake_count=int(mistake_count),
    )


def bulk_operator_timing_metrics(
    db: Session, *, operator_ids: list[int], project_id: int | None, start, end
) -> dict[int, dict]:
    """DB-aggregated (GROUP BY operator_id) version for admin tables covering many operators at once."""
    result = {op_id: dict(_EMPTY_TIMING_METRICS) for op_id in operator_ids}
    if not operator_ids:
        return result

    base_conds = [
        ChatSession.operator_id.in_(operator_ids),
        ChatSession.started_at >= start,
        ChatSession.started_at <= end,
    ]
    if project_id is not None:
        base_conds.append(ChatSession.project_id == project_id)

    status_rows = db.execute(
        select(ChatSession.operator_id, ChatSession.status, func.count())
        .where(*base_conds)
        .group_by(ChatSession.operator_id, ChatSession.status)
    ).all()
    status_by_op: dict[int, dict] = {}
    for op_id, sess_status, cnt in status_rows:
        status_by_op.setdefault(op_id, {})[sess_status] = cnt

    sla_rows = db.execute(
        select(ChatSession.operator_id, ChatSession.first_response_sla_met, func.count())
        .where(*base_conds, ChatSession.first_response_sla_met.is_not(None))
        .group_by(ChatSession.operator_id, ChatSession.first_response_sla_met)
    ).all()
    sla_by_op: dict[int, dict] = {}
    for op_id, met, cnt in sla_rows:
        sla_by_op.setdefault(op_id, {})[met] = cnt

    avg_rows = db.execute(
        select(
            ChatSession.operator_id,
            func.avg(func.extract("epoch", ChatSession.first_response_at - ChatSession.started_at)),
        )
        .where(*base_conds, ChatSession.first_response_at.is_not(None))
        .group_by(ChatSession.operator_id)
    ).all()
    avg_fr_by_op = {op_id: float(avg) if avg is not None else None for op_id, avg in avg_rows}

    handling_rows = db.execute(
        select(
            ChatSession.operator_id,
            func.avg(func.extract("epoch", ChatSession.closed_at - ChatSession.started_at)),
        )
        .where(*base_conds, ChatSession.status == ChatSessionStatus.COMPLETED)
        .group_by(ChatSession.operator_id)
    ).all()
    avg_handle_by_op = {op_id: float(avg) if avg is not None else None for op_id, avg in handling_rows}

    missing_ty_rows = db.execute(
        select(ChatSession.operator_id, func.count())
        .where(*base_conds, ChatSession.thank_you_present.is_(False))
        .group_by(ChatSession.operator_id)
    ).all()
    missing_ty_by_op = {op_id: int(cnt) for op_id, cnt in missing_ty_rows}

    mistake_conds = [
        OperatorMistake.operator_id.in_(operator_ids),
        OperatorMistake.occurred_at >= start,
        OperatorMistake.occurred_at <= end,
    ]
    if project_id is not None:
        mistake_conds.append(OperatorMistake.project_id == project_id)
    mistake_rows = db.execute(
        select(OperatorMistake.operator_id, func.count()).where(*mistake_conds).group_by(OperatorMistake.operator_id)
    ).all()
    mistake_by_op = {op_id: int(cnt) for op_id, cnt in mistake_rows}

    for op_id in operator_ids:
        statuses = status_by_op.get(op_id, {})
        slas = sla_by_op.get(op_id, {})
        result[op_id] = _timing_metrics_from_rows(
            total=sum(statuses.values()),
            completed=statuses.get(ChatSessionStatus.COMPLETED, 0),
            abandoned=statuses.get(ChatSessionStatus.ABANDONED, 0),
            auto_closed=statuses.get(ChatSessionStatus.AUTO_CLOSED, 0),
            sla_met=slas.get(True, 0),
            sla_breached=slas.get(False, 0),
            avg_first_response=avg_fr_by_op.get(op_id),
            avg_handling=avg_handle_by_op.get(op_id),
            missing_thank_you=missing_ty_by_op.get(op_id, 0),
            mistake_count=mistake_by_op.get(op_id, 0),
        )
    return result


# ---- Per-customer timing metrics (section: customer analytics) ----
# Same ChatSession-authoritative source as the operator timing metrics above -- mirrors
# get_operator_timing_metrics exactly, keyed by member_id instead of operator_id.


def get_member_timing_metrics(db: Session, *, member_id: int, project_id: int | None, start, end) -> dict:
    conds = [ChatSession.member_id == member_id, ChatSession.started_at >= start, ChatSession.started_at <= end]
    if project_id is not None:
        conds.append(ChatSession.project_id == project_id)

    status_counts = dict(
        db.execute(select(ChatSession.status, func.count()).where(*conds).group_by(ChatSession.status)).all()
    )
    total = sum(status_counts.values())
    completed = status_counts.get(ChatSessionStatus.COMPLETED, 0)
    abandoned = status_counts.get(ChatSessionStatus.ABANDONED, 0)
    auto_closed = status_counts.get(ChatSessionStatus.AUTO_CLOSED, 0)

    sla_counts = dict(
        db.execute(
            select(ChatSession.first_response_sla_met, func.count())
            .where(*conds, ChatSession.first_response_sla_met.is_not(None))
            .group_by(ChatSession.first_response_sla_met)
        ).all()
    )
    sla_met = sla_counts.get(True, 0)
    sla_breached = sla_counts.get(False, 0)

    avg_first_response = db.scalar(
        select(func.avg(func.extract("epoch", ChatSession.first_response_at - ChatSession.started_at))).where(
            *conds, ChatSession.first_response_at.is_not(None)
        )
    )
    avg_handling = db.scalar(
        select(func.avg(func.extract("epoch", ChatSession.closed_at - ChatSession.started_at))).where(
            *conds, ChatSession.status == ChatSessionStatus.COMPLETED
        )
    )
    missing_thank_you = db.scalar(select(func.count()).where(*conds, ChatSession.thank_you_present.is_(False))) or 0

    mistake_conds = [
        ChatSession.member_id == member_id,
        OperatorMistake.occurred_at >= start,
        OperatorMistake.occurred_at <= end,
    ]
    if project_id is not None:
        mistake_conds.append(ChatSession.project_id == project_id)
    mistake_count = (
        db.scalar(
            select(func.count())
            .select_from(OperatorMistake)
            .join(ChatSession, ChatSession.id == OperatorMistake.session_id)
            .where(*mistake_conds)
        )
        or 0
    )

    return _timing_metrics_from_rows(
        total=total,
        completed=completed,
        abandoned=abandoned,
        auto_closed=auto_closed,
        sla_met=sla_met,
        sla_breached=sla_breached,
        avg_first_response=float(avg_first_response) if avg_first_response is not None else None,
        avg_handling=float(avg_handling) if avg_handling is not None else None,
        missing_thank_you=int(missing_thank_you),
        mistake_count=int(mistake_count),
    )


def get_member_active_chats_now(db: Session, *, member_id: int, project_id: int | None) -> int:
    """Current-state snapshot (not date-filtered) -- mirrors how operator analytics reports
    'active' conversations as a live count rather than a period figure."""
    conds = [ChatSession.member_id == member_id, ChatSession.status == ChatSessionStatus.ACTIVE]
    if project_id is not None:
        conds.append(ChatSession.project_id == project_id)
    return int(db.scalar(select(func.count()).where(*conds)) or 0)


def get_member_first_last_chat(db: Session, *, member_id: int, project_id: int | None) -> tuple[datetime | None, datetime | None]:
    """Lifetime first/last chat timestamps -- intentionally NOT bound by the analytics date
    range filter, since these are profile facts about the customer, not period activity."""
    conds = [ChatSession.member_id == member_id]
    if project_id is not None:
        conds.append(ChatSession.project_id == project_id)
    first_at = db.scalar(select(func.min(ChatSession.started_at)).where(*conds))
    last_at = db.scalar(select(func.max(ChatSession.started_at)).where(*conds))
    return first_at, last_at


# ---- Chat History report (section: chat history / chat reports) ----
# Row-level ChatSession report for the admin Chat History page. `assigned_at` is the
# conversation's created_at -- the operator is fixed for the lifetime of an operator<->member
# conversation thread (assigned once via MemberAssignment when the thread is created), so
# there is no separate "assignment happened later" timestamp anywhere else in this schema.


def list_chat_sessions(
    db: Session,
    *,
    project_id: int | None,
    operator_id: int | None,
    member_id: int | None,
    status_filter: ChatSessionStatus | None,
    start: datetime,
    end: datetime,
    search: str | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    MemberUser = aliased(User)
    OperatorUser = aliased(User)

    conds = [ChatSession.started_at >= start, ChatSession.started_at <= end]
    if project_id is not None:
        conds.append(ChatSession.project_id == project_id)
    if operator_id is not None:
        conds.append(ChatSession.operator_id == operator_id)
    if member_id is not None:
        conds.append(ChatSession.member_id == member_id)
    if status_filter is not None:
        conds.append(ChatSession.status == status_filter)
    if search and search.strip():
        like = f"%{search.strip()}%"
        conds.append(
            or_(
                MemberUser.name.ilike(like),
                MemberUser.uid.ilike(like),
                OperatorUser.name.ilike(like),
                OperatorUser.uid.ilike(like),
            )
        )

    base = (
        select(
            ChatSession.id,
            ChatSession.conversation_id,
            ChatSession.project_id,
            Project.name.label("project_name"),
            ChatSession.member_id,
            MemberUser.name.label("member_name"),
            MemberUser.uid.label("member_uid"),
            ChatSession.operator_id,
            OperatorUser.name.label("operator_name"),
            OperatorUser.uid.label("operator_uid"),
            Conversation.created_at.label("assigned_at"),
            ChatSession.started_at,
            ChatSession.first_response_at,
            ChatSession.closed_at,
            ChatSession.status,
        )
        .select_from(ChatSession)
        .join(Project, Project.id == ChatSession.project_id)
        .join(Conversation, Conversation.id == ChatSession.conversation_id)
        .join(MemberUser, MemberUser.id == ChatSession.member_id)
        .join(OperatorUser, OperatorUser.id == ChatSession.operator_id)
        .where(*conds)
    )

    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0

    rows = db.execute(base.order_by(ChatSession.started_at.desc()).limit(limit).offset(offset)).all()

    now = now_utc()
    result: list[dict] = []
    for r in rows:
        duration_seconds = None
        if r.closed_at is not None:
            duration_seconds = int((r.closed_at - r.started_at).total_seconds())
        elif r.status == ChatSessionStatus.ACTIVE:
            duration_seconds = int((now - r.started_at).total_seconds())
        result.append(
            {
                "session_id": r.id,
                "conversation_id": r.conversation_id,
                "project_id": r.project_id,
                "project_name": r.project_name,
                "member_id": r.member_id,
                "member_name": r.member_name,
                "member_uid": r.member_uid,
                "operator_id": r.operator_id,
                "operator_name": r.operator_name,
                "operator_uid": r.operator_uid,
                "started_at": r.started_at,
                "assigned_at": r.assigned_at,
                "first_response_at": r.first_response_at,
                "closed_at": r.closed_at,
                "duration_seconds": duration_seconds,
                "status": r.status.value,
            }
        )
    return result, int(total)


def get_chat_session_detail(db: Session, *, session_id: int) -> dict | None:
    session = db.scalar(select(ChatSession).where(ChatSession.id == session_id))
    if session is None:
        return None

    member = db.get(User, session.member_id)
    operator = db.get(User, session.operator_id)
    project = db.get(Project, session.project_id)
    conversation = db.get(Conversation, session.conversation_id)

    window_end = session.closed_at or now_utc()
    messages = list(
        db.scalars(
            select(Message)
            .where(
                Message.conversation_id == session.conversation_id,
                Message.created_at >= session.started_at,
                Message.created_at <= window_end,
            )
            .order_by(Message.created_at.asc())
        ).all()
    )
    events = list(
        db.scalars(
            select(ChatSessionEvent)
            .where(ChatSessionEvent.session_id == session.id)
            .order_by(ChatSessionEvent.occurred_at.asc())
        ).all()
    )

    duration_seconds = None
    if session.closed_at is not None:
        duration_seconds = int((session.closed_at - session.started_at).total_seconds())
    elif session.status == ChatSessionStatus.ACTIVE:
        duration_seconds = int((now_utc() - session.started_at).total_seconds())

    return {
        "session_id": session.id,
        "conversation_id": session.conversation_id,
        "project_id": session.project_id,
        "project_name": project.name if project else "Unknown project",
        "member_id": session.member_id,
        "member_name": member.name if member else "Unknown",
        "member_uid": member.uid if member else "",
        "operator_id": session.operator_id,
        "operator_name": operator.name if operator else "Unknown",
        "operator_uid": operator.uid if operator else "",
        "started_at": session.started_at,
        "assigned_at": conversation.created_at if conversation else session.started_at,
        "first_response_at": session.first_response_at,
        "closed_at": session.closed_at,
        "duration_seconds": duration_seconds,
        "status": session.status.value,
        "thank_you_present": session.thank_you_present,
        "first_response_sla_met": session.first_response_sla_met,
        "messages": messages,
        "events": [
            {"event_type": e.event_type.value, "occurred_at": e.occurred_at, "detail": e.detail} for e in events
        ],
    }
