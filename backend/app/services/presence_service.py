from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import (
    MemberAssignment,
    MembershipStatus,
    OperatorAssignment,
    OperatorPresenceHistory,
    Presence,
    PresenceEventType,
    Project,
    ProjectUser,
    User,
    UserRole,
)


def set_online(db: Session, *, project_id: int, user_id: int) -> Presence:
    presence = db.scalar(select(Presence).where(Presence.project_id == project_id, Presence.user_id == user_id))
    if not presence:
        presence = Presence(project_id=project_id, user_id=user_id, is_online=True)
        db.add(presence)
        db.flush()
        return presence

    presence.is_online = True
    return presence


def set_offline(db: Session, *, project_id: int, user_id: int) -> Presence:
    now = datetime.now(timezone.utc)
    presence = db.scalar(select(Presence).where(Presence.project_id == project_id, Presence.user_id == user_id))
    if not presence:
        presence = Presence(project_id=project_id, user_id=user_id, is_online=False, last_seen_at=now)
        db.add(presence)
        db.flush()
        return presence

    presence.is_online = False
    presence.last_seen_at = now
    return presence


def _can_view_presence(db: Session, *, viewer: User, target: User, project_id: int) -> bool:
    if viewer.id == target.id:
        return True

    if viewer.role == UserRole.ADMIN:
        return True

    if viewer.role == UserRole.OPERATOR:
        if target.role == UserRole.MEMBER:
            item = db.scalar(
                select(MemberAssignment).where(
                    MemberAssignment.project_id == project_id,
                    MemberAssignment.operator_id == viewer.id,
                    MemberAssignment.member_id == target.id,
                    MemberAssignment.is_active.is_(True),
                )
            )
            return item is not None
        if target.role == UserRole.ADMIN:
            item = db.scalar(
                select(OperatorAssignment).where(
                    OperatorAssignment.project_id == project_id,
                    OperatorAssignment.operator_id == viewer.id,
                    OperatorAssignment.admin_id == target.id,
                    OperatorAssignment.is_active.is_(True),
                )
            )
            return item is not None
        return False

    if viewer.role == UserRole.MEMBER and target.role == UserRole.OPERATOR:
        item = db.scalar(
            select(MemberAssignment).where(
                MemberAssignment.project_id == project_id,
                MemberAssignment.operator_id == target.id,
                MemberAssignment.member_id == viewer.id,
                MemberAssignment.is_active.is_(True),
            )
        )
        return item is not None

    return False


def get_presence_viewers(db: Session, *, project_id: int, target_user_id: int) -> list[int]:
    target = db.scalar(select(User).where(User.id == target_user_id))
    if not target:
        return []

    project_members = db.scalars(
        select(User)
        .join(ProjectUser, ProjectUser.user_id == User.id)
        .where(
            ProjectUser.project_id == project_id,
            ProjectUser.status == MembershipStatus.ACTIVE,
            User.is_active.is_(True),
        )
    ).all()

    admins = db.scalars(select(User).where(User.role == UserRole.ADMIN, User.is_active.is_(True))).all()
    viewers = {item.id: item for item in project_members}
    for admin in admins:
        viewers[admin.id] = admin

    return [viewer.id for viewer in viewers.values() if _can_view_presence(db, viewer=viewer, target=target, project_id=project_id)]


def record_presence_event(db: Session, *, user_id: int, project_id: int, event_type: PresenceEventType) -> None:
    """Append a server-timestamped history row, deduped against the immediately-preceding
    row for this (user, project) so ONLINE/OFFLINE rows always alternate cleanly -- an
    operator with several simultaneous websocket tabs must not fabricate extra online
    segments just because each tab connects/disconnects independently."""
    last = db.scalar(
        select(OperatorPresenceHistory.event_type)
        .where(OperatorPresenceHistory.user_id == user_id, OperatorPresenceHistory.project_id == project_id)
        .order_by(OperatorPresenceHistory.occurred_at.desc(), OperatorPresenceHistory.id.desc())
        .limit(1)
    )
    if last == event_type:
        return
    db.add(OperatorPresenceHistory(user_id=user_id, project_id=project_id, event_type=event_type))


@dataclass
class _PresenceSegment:
    project_id: int
    started_at: datetime
    ended_at: datetime | None  # None = still online as of "now"
    duration_seconds: int | None


def _fetch_presence_events(
    db: Session, *, user_id: int, project_id: int | None, end: datetime
) -> list[OperatorPresenceHistory]:
    conds = [OperatorPresenceHistory.user_id == user_id, OperatorPresenceHistory.occurred_at <= end]
    if project_id is not None:
        conds.append(OperatorPresenceHistory.project_id == project_id)
    return list(
        db.scalars(
            select(OperatorPresenceHistory)
            .where(*conds)
            .order_by(OperatorPresenceHistory.occurred_at.asc(), OperatorPresenceHistory.id.asc())
        ).all()
    )


def _build_presence_segments(events: list[OperatorPresenceHistory]) -> list[_PresenceSegment]:
    """Pair each ONLINE row with the next OFFLINE row for the same project (events are
    already deduped/alternating per project by record_presence_event). A trailing ONLINE
    with no following OFFLINE is an in-progress segment (ended_at=None)."""
    by_project: dict[int, list[OperatorPresenceHistory]] = {}
    for e in events:
        by_project.setdefault(e.project_id, []).append(e)

    segments: list[_PresenceSegment] = []
    for project_id, evs in by_project.items():
        pending_start: datetime | None = None
        for e in evs:
            if e.event_type == PresenceEventType.ONLINE:
                pending_start = e.occurred_at
            elif e.event_type == PresenceEventType.OFFLINE and pending_start is not None:
                segments.append(
                    _PresenceSegment(
                        project_id=project_id,
                        started_at=pending_start,
                        ended_at=e.occurred_at,
                        duration_seconds=int((e.occurred_at - pending_start).total_seconds()),
                    )
                )
                pending_start = None
        if pending_start is not None:
            segments.append(_PresenceSegment(project_id=project_id, started_at=pending_start, ended_at=None, duration_seconds=None))
    return segments


def list_presence_history(
    db: Session, *, operator_id: int, project_id: int | None, start: datetime, end: datetime
) -> list[dict]:
    """Row-per-event view for the Activity/Presence History table. Each ONLINE row carries
    the duration of that online segment (completed, or running-to-now if still online);
    OFFLINE rows carry no duration -- matching how the feature is meant to read."""
    now = datetime.now(timezone.utc)
    events = _fetch_presence_events(db, user_id=operator_id, project_id=project_id, end=min(end, now))
    segments = _build_presence_segments(events)
    segment_by_start = {(s.project_id, s.started_at): s for s in segments}

    relevant_project_ids = {e.project_id for e in events}
    project_names = (
        {p.id: p.name for p in db.scalars(select(Project).where(Project.id.in_(relevant_project_ids))).all()}
        if relevant_project_ids
        else {}
    )

    rows: list[dict] = []
    for e in events:
        if e.occurred_at < start or e.occurred_at > end:
            continue
        duration_seconds = None
        is_ongoing = False
        if e.event_type == PresenceEventType.ONLINE:
            seg = segment_by_start.get((e.project_id, e.occurred_at))
            if seg is not None:
                if seg.ended_at is not None:
                    duration_seconds = seg.duration_seconds
                else:
                    is_ongoing = True
                    duration_seconds = int((now - seg.started_at).total_seconds())
        rows.append(
            {
                "id": e.id,
                "user_id": e.user_id,
                "project_id": e.project_id,
                "project_name": project_names.get(e.project_id, "Unknown project"),
                "event_type": e.event_type.value,
                "occurred_at": e.occurred_at,
                "duration_seconds": duration_seconds,
                "is_ongoing": is_ongoing,
            }
        )
    rows.sort(key=lambda r: r["occurred_at"], reverse=True)
    return rows


def get_presence_analytics(db: Session, *, operator_id: int, project_id: int | None, start: datetime, end: datetime) -> dict:
    """Aggregate presence figures for the selected date range, built only from the
    server-timestamped history table (never frontend state)."""
    now = datetime.now(timezone.utc)
    events = _fetch_presence_events(db, user_id=operator_id, project_id=project_id, end=now)
    segments = _build_presence_segments(events)

    window_end = min(end, now)
    total_online_seconds = 0
    session_count = 0
    active_session_seconds: int | None = None
    for seg in segments:
        seg_end = seg.ended_at or now
        overlap_start = max(seg.started_at, start)
        overlap_end = min(seg_end, window_end)
        if overlap_end > overlap_start:
            total_online_seconds += int((overlap_end - overlap_start).total_seconds())
        if start <= seg.started_at <= end:
            session_count += 1
        if seg.ended_at is None:
            active_session_seconds = int((now - seg.started_at).total_seconds())

    span_seconds = max(0, int((window_end - start).total_seconds()))
    total_offline_seconds = max(0, span_seconds - total_online_seconds)

    project_conds = [OperatorPresenceHistory.project_id == project_id] if project_id is not None else []
    first_login_at = db.scalar(
        select(func.min(OperatorPresenceHistory.occurred_at)).where(
            OperatorPresenceHistory.user_id == operator_id,
            OperatorPresenceHistory.event_type == PresenceEventType.ONLINE,
            OperatorPresenceHistory.occurred_at >= start,
            OperatorPresenceHistory.occurred_at <= end,
            *project_conds,
        )
    )
    last_logout_at = db.scalar(
        select(func.max(OperatorPresenceHistory.occurred_at)).where(
            OperatorPresenceHistory.user_id == operator_id,
            OperatorPresenceHistory.event_type == PresenceEventType.OFFLINE,
            OperatorPresenceHistory.occurred_at >= start,
            OperatorPresenceHistory.occurred_at <= end,
            *project_conds,
        )
    )

    presence_conds = [Presence.project_id == project_id] if project_id is not None else []
    is_online = bool(
        db.scalar(select(func.bool_or(Presence.is_online)).where(Presence.user_id == operator_id, *presence_conds)) or False
    )

    return {
        "is_online": is_online,
        "total_online_seconds": total_online_seconds,
        "total_offline_seconds": total_offline_seconds,
        "session_count": session_count,
        "first_login_at": first_login_at,
        "last_logout_at": last_logout_at,
        "active_session_seconds": active_session_seconds,
    }


def get_visible_presence(db: Session, *, project_id: int, viewer: User) -> list[Presence]:
    all_presence = db.scalars(select(Presence).where(Presence.project_id == project_id)).all()
    if not all_presence:
        return []

    users_by_id = {
        user.id: user
        for user in db.scalars(
            select(User)
            .join(ProjectUser, ProjectUser.user_id == User.id)
            .where(ProjectUser.project_id == project_id, ProjectUser.status == MembershipStatus.ACTIVE)
        ).all()
    }

    visible: list[Presence] = []
    for item in all_presence:
        target = users_by_id.get(item.user_id)
        if target and _can_view_presence(db, viewer=viewer, target=target, project_id=project_id):
            visible.append(item)
    return visible
