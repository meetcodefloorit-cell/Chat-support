"""
Analytics built strictly from real conversation/message/assignment/presence data.

No conversation "lifecycle status", accept/close timestamps, response-window, or SLA
configuration exist anywhere else in this codebase -- so metrics like "missed chat",
"abandoned chat", "SLA compliance", or accept-to-close "handling time" are intentionally
NOT implemented here. Everything below is derived only from fields that already exist:
Conversation.created_at, Message.created_at/sender_role, MemberAssignment.is_active,
ProjectUser.status, Presence.is_online, OperatorAssignment.is_active.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.models import (
    Conversation,
    ConversationType,
    MemberAssignment,
    MembershipStatus,
    Message,
    OperatorAssignment,
    Presence,
    Project,
    ProjectUser,
    User,
    UserRole,
)
from app.schemas.analytics import (
    AnalyticsRange,
    ConversationBreakdown,
    ConversationRef,
    MessageStats,
    PresenceStatus,
    ResponseTimePoint,
    ResponseTimeStats,
    VolumePoint,
    WorkloadOperator,
)

GRANULARITIES = {"hour", "day", "week"}


def normalize_range(
    start_date: datetime | None,
    end_date: datetime | None,
    granularity: str | None,
) -> AnalyticsRange:
    now = datetime.now(timezone.utc)
    end = end_date or now
    start = start_date or (end - timedelta(days=30))
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if start > end:
        start, end = end, start

    span = end - start
    if granularity and granularity in GRANULARITIES:
        resolved = granularity
    elif span <= timedelta(days=2):
        resolved = "hour"
    elif span <= timedelta(days=60):
        resolved = "day"
    else:
        resolved = "week"

    return AnalyticsRange(start=start, end=end, granularity=resolved)


def operator_conversation_ids(db: Session, *, operator_id: int, project_id: int | None = None) -> list[int]:
    stmt = select(Conversation.id).where(
        Conversation.type == ConversationType.OPERATOR_MEMBER,
        Conversation.operator_id == operator_id,
    )
    if project_id is not None:
        stmt = stmt.where(Conversation.project_id == project_id)
    return list(db.scalars(stmt).all())


def _classify(status: MembershipStatus | None, current_operator_id: int | None, current_active: bool | None, operator_id: int) -> str:
    if status is None:
        return "removed"
    if status == MembershipStatus.TERMINATED:
        return "terminated"
    if status == MembershipStatus.REMOVED:
        return "removed"
    if current_operator_id == operator_id and bool(current_active):
        return "active"
    return "reassigned"


def get_operator_conversation_detail(
    db: Session, *, operator_id: int, project_id: int | None = None
) -> tuple[ConversationBreakdown, dict[str, list[ConversationRef]]]:
    """Row-level detail for a single operator: real-time enough since bounded by one operator's conversations."""
    conds = [Conversation.type == ConversationType.OPERATOR_MEMBER, Conversation.operator_id == operator_id]
    if project_id is not None:
        conds.append(Conversation.project_id == project_id)

    stmt = (
        select(
            Conversation.id,
            Conversation.project_id,
            Conversation.member_id,
            Project.name,
            User.name,
            User.uid,
            ProjectUser.status,
            MemberAssignment.operator_id,
            MemberAssignment.is_active,
        )
        .select_from(Conversation)
        .join(Project, Project.id == Conversation.project_id)
        .join(User, User.id == Conversation.member_id)
        .outerjoin(
            ProjectUser,
            (ProjectUser.project_id == Conversation.project_id) & (ProjectUser.user_id == Conversation.member_id),
        )
        .outerjoin(
            MemberAssignment,
            (MemberAssignment.project_id == Conversation.project_id) & (MemberAssignment.member_id == Conversation.member_id),
        )
        .where(*conds)
    )
    rows = db.execute(stmt).all()

    counts = ConversationBreakdown()
    refs: dict[str, list[ConversationRef]] = {"active": [], "reassigned": [], "terminated": [], "removed": []}

    for conv_id, proj_id, member_id, project_name, member_name, member_uid, status, cur_op_id, cur_active in rows:
        category = _classify(status, cur_op_id, cur_active, operator_id)
        setattr(counts, category, getattr(counts, category) + 1)
        if len(refs[category]) < 200:
            refs[category].append(
                ConversationRef(
                    conversation_id=conv_id,
                    project_id=proj_id,
                    project_name=project_name,
                    member_id=member_id,
                    member_name=member_name,
                    member_uid=member_uid,
                )
            )

    return counts, refs


def get_conversations_started(
    db: Session, *, operator_id: int, project_id: int | None, start: datetime, end: datetime
) -> int:
    conds = [
        Conversation.type == ConversationType.OPERATOR_MEMBER,
        Conversation.operator_id == operator_id,
        Conversation.created_at >= start,
        Conversation.created_at <= end,
    ]
    if project_id is not None:
        conds.append(Conversation.project_id == project_id)
    return int(db.scalar(select(func.count(Conversation.id)).where(*conds)) or 0)


def get_message_stats(
    db: Session, *, conversation_ids: list[int], start: datetime, end: datetime
) -> MessageStats:
    if not conversation_ids:
        return MessageStats()
    stmt = select(
        func.sum(case((Message.sender_role == UserRole.OPERATOR, 1), else_=0)),
        func.sum(case((Message.sender_role == UserRole.MEMBER, 1), else_=0)),
    ).where(
        Message.conversation_id.in_(conversation_ids),
        Message.created_at >= start,
        Message.created_at <= end,
    )
    sent, received = db.execute(stmt).one()
    return MessageStats(sent=int(sent or 0), received=int(received or 0))


def _response_pairs_subquery(conversation_ids: list[int]):
    next_role = func.lead(Message.sender_role).over(
        partition_by=Message.conversation_id, order_by=Message.created_at
    )
    next_created = func.lead(Message.created_at).over(
        partition_by=Message.conversation_id, order_by=Message.created_at
    )
    return (
        select(
            Message.conversation_id.label("conversation_id"),
            Message.sender_role.label("sender_role"),
            Message.created_at.label("created_at"),
            next_role.label("next_role"),
            next_created.label("next_created_at"),
        )
        .where(Message.conversation_id.in_(conversation_ids))
        .subquery()
    )


def get_response_time_stats(
    db: Session, *, conversation_ids: list[int], start: datetime, end: datetime
) -> ResponseTimeStats:
    if not conversation_ids:
        return ResponseTimeStats()
    sub = _response_pairs_subquery(conversation_ids)
    delta = func.extract("epoch", sub.c.next_created_at - sub.c.created_at)
    stmt = select(func.avg(delta), func.min(delta), func.max(delta), func.count()).where(
        sub.c.sender_role == UserRole.MEMBER,
        sub.c.next_role == UserRole.OPERATOR,
        sub.c.created_at >= start,
        sub.c.created_at <= end,
    )
    avg_s, min_s, max_s, cnt = db.execute(stmt).one()
    return ResponseTimeStats(
        avg_seconds=float(avg_s) if avg_s is not None else None,
        min_seconds=float(min_s) if min_s is not None else None,
        max_seconds=float(max_s) if max_s is not None else None,
        sample_size=int(cnt or 0),
    )


def get_response_time_series(
    db: Session, *, conversation_ids: list[int], start: datetime, end: datetime, granularity: str
) -> list[ResponseTimePoint]:
    if not conversation_ids:
        return []
    sub = _response_pairs_subquery(conversation_ids)
    delta = func.extract("epoch", sub.c.next_created_at - sub.c.created_at)
    bucket = func.date_trunc(granularity, sub.c.created_at).label("bucket")
    stmt = (
        select(bucket, func.avg(delta), func.count())
        .where(
            sub.c.sender_role == UserRole.MEMBER,
            sub.c.next_role == UserRole.OPERATOR,
            sub.c.created_at >= start,
            sub.c.created_at <= end,
        )
        .group_by(bucket)
        .order_by(bucket)
    )
    return [
        ResponseTimePoint(bucket=b, avg_seconds=float(avg) if avg is not None else None, sample_size=int(cnt or 0))
        for b, avg, cnt in db.execute(stmt).all()
    ]


def get_volume_series(
    db: Session,
    *,
    operator_id: int,
    project_id: int | None,
    conversation_ids: list[int],
    start: datetime,
    end: datetime,
    granularity: str,
) -> list[VolumePoint]:
    buckets: dict[datetime, VolumePoint] = {}

    if conversation_ids:
        msg_bucket = func.date_trunc(granularity, Message.created_at).label("bucket")
        msg_stmt = (
            select(
                msg_bucket,
                func.sum(case((Message.sender_role == UserRole.OPERATOR, 1), else_=0)),
                func.sum(case((Message.sender_role == UserRole.MEMBER, 1), else_=0)),
            )
            .where(
                Message.conversation_id.in_(conversation_ids),
                Message.created_at >= start,
                Message.created_at <= end,
            )
            .group_by(msg_bucket)
        )
        for b, sent, received in db.execute(msg_stmt).all():
            point = buckets.setdefault(b, VolumePoint(bucket=b))
            point.messages_sent = int(sent or 0)
            point.messages_received = int(received or 0)

    conv_conds = [
        Conversation.type == ConversationType.OPERATOR_MEMBER,
        Conversation.operator_id == operator_id,
        Conversation.created_at >= start,
        Conversation.created_at <= end,
    ]
    if project_id is not None:
        conv_conds.append(Conversation.project_id == project_id)
    conv_bucket = func.date_trunc(granularity, Conversation.created_at).label("bucket")
    conv_stmt = (
        select(conv_bucket, func.count(Conversation.id)).where(*conv_conds).group_by(conv_bucket)
    )
    for b, started in db.execute(conv_stmt).all():
        point = buckets.setdefault(b, VolumePoint(bucket=b))
        point.conversations_started = int(started or 0)

    return [buckets[b] for b in sorted(buckets.keys())]


def member_conversation_ids(db: Session, *, member_id: int, project_id: int | None = None) -> list[int]:
    stmt = select(Conversation.id).where(
        Conversation.type == ConversationType.OPERATOR_MEMBER,
        Conversation.member_id == member_id,
    )
    if project_id is not None:
        stmt = stmt.where(Conversation.project_id == project_id)
    return list(db.scalars(stmt).all())


def get_member_volume_series(
    db: Session,
    *,
    member_id: int,
    project_id: int | None,
    conversation_ids: list[int],
    start: datetime,
    end: datetime,
    granularity: str,
) -> list[VolumePoint]:
    buckets: dict[datetime, VolumePoint] = {}

    if conversation_ids:
        msg_bucket = func.date_trunc(granularity, Message.created_at).label("bucket")
        msg_stmt = (
            select(
                msg_bucket,
                func.sum(case((Message.sender_role == UserRole.OPERATOR, 1), else_=0)),
                func.sum(case((Message.sender_role == UserRole.MEMBER, 1), else_=0)),
            )
            .where(
                Message.conversation_id.in_(conversation_ids),
                Message.created_at >= start,
                Message.created_at <= end,
            )
            .group_by(msg_bucket)
        )
        for b, sent, received in db.execute(msg_stmt).all():
            point = buckets.setdefault(b, VolumePoint(bucket=b))
            point.messages_sent = int(sent or 0)
            point.messages_received = int(received or 0)

    conv_conds = [
        Conversation.type == ConversationType.OPERATOR_MEMBER,
        Conversation.member_id == member_id,
        Conversation.created_at >= start,
        Conversation.created_at <= end,
    ]
    if project_id is not None:
        conv_conds.append(Conversation.project_id == project_id)
    conv_bucket = func.date_trunc(granularity, Conversation.created_at).label("bucket")
    conv_stmt = select(conv_bucket, func.count(Conversation.id)).where(*conv_conds).group_by(conv_bucket)
    for b, started in db.execute(conv_stmt).all():
        point = buckets.setdefault(b, VolumePoint(bucket=b))
        point.conversations_started = int(started or 0)

    return [buckets[b] for b in sorted(buckets.keys())]


def get_operator_presence(db: Session, *, operator_id: int, project_id: int | None = None) -> list[PresenceStatus]:
    conds = [
        OperatorAssignment.operator_id == operator_id,
        OperatorAssignment.is_active.is_(True),
    ]
    if project_id is not None:
        conds.append(OperatorAssignment.project_id == project_id)

    stmt = (
        select(Project.id, Project.name, Presence.is_online, Presence.last_seen_at)
        .select_from(OperatorAssignment)
        .join(Project, Project.id == OperatorAssignment.project_id)
        .outerjoin(
            Presence,
            (Presence.project_id == OperatorAssignment.project_id) & (Presence.user_id == operator_id),
        )
        .where(*conds)
        .order_by(Project.id.asc())
    )
    return [
        PresenceStatus(project_id=pid, project_name=pname, is_online=bool(online), last_seen_at=last_seen)
        for pid, pname, online, last_seen in db.execute(stmt).all()
    ]


def list_active_operator_ids(db: Session, *, project_id: int | None = None) -> list[int]:
    stmt = select(OperatorAssignment.operator_id).where(OperatorAssignment.is_active.is_(True)).distinct()
    if project_id is not None:
        stmt = stmt.where(OperatorAssignment.project_id == project_id)
    return list(db.scalars(stmt).all())


def bulk_conversation_breakdown(
    db: Session, *, operator_ids: list[int], project_id: int | None = None
) -> dict[int, ConversationBreakdown]:
    """DB-aggregated (GROUP BY) status breakdown for many operators at once -- used by admin views."""
    result: dict[int, ConversationBreakdown] = {op_id: ConversationBreakdown() for op_id in operator_ids}
    if not operator_ids:
        return result

    category = case(
        (ProjectUser.status.is_(None), "removed"),
        (ProjectUser.status == MembershipStatus.TERMINATED, "terminated"),
        (ProjectUser.status == MembershipStatus.REMOVED, "removed"),
        (
            (MemberAssignment.operator_id == Conversation.operator_id) & (MemberAssignment.is_active.is_(True)),
            "active",
        ),
        else_="reassigned",
    ).label("category")

    conds = [Conversation.type == ConversationType.OPERATOR_MEMBER, Conversation.operator_id.in_(operator_ids)]
    if project_id is not None:
        conds.append(Conversation.project_id == project_id)

    stmt = (
        select(Conversation.operator_id, category, func.count(Conversation.id))
        .select_from(Conversation)
        .outerjoin(
            ProjectUser,
            (ProjectUser.project_id == Conversation.project_id) & (ProjectUser.user_id == Conversation.member_id),
        )
        .outerjoin(
            MemberAssignment,
            (MemberAssignment.project_id == Conversation.project_id) & (MemberAssignment.member_id == Conversation.member_id),
        )
        .where(*conds)
        .group_by(Conversation.operator_id, category)
    )
    for op_id, cat, cnt in db.execute(stmt).all():
        setattr(result[op_id], cat, getattr(result[op_id], cat) + int(cnt or 0))
    return result


def bulk_conversations_started(
    db: Session, *, operator_ids: list[int], project_id: int | None, start: datetime, end: datetime
) -> dict[int, int]:
    result = {op_id: 0 for op_id in operator_ids}
    if not operator_ids:
        return result
    conds = [
        Conversation.type == ConversationType.OPERATOR_MEMBER,
        Conversation.operator_id.in_(operator_ids),
        Conversation.created_at >= start,
        Conversation.created_at <= end,
    ]
    if project_id is not None:
        conds.append(Conversation.project_id == project_id)
    stmt = select(Conversation.operator_id, func.count(Conversation.id)).where(*conds).group_by(Conversation.operator_id)
    for op_id, cnt in db.execute(stmt).all():
        result[op_id] = int(cnt or 0)
    return result


def bulk_message_stats(
    db: Session, *, operator_ids: list[int], project_id: int | None, start: datetime, end: datetime
) -> dict[int, MessageStats]:
    result = {op_id: MessageStats() for op_id in operator_ids}
    if not operator_ids:
        return result
    conds = [
        Conversation.type == ConversationType.OPERATOR_MEMBER,
        Conversation.operator_id.in_(operator_ids),
        Message.created_at >= start,
        Message.created_at <= end,
    ]
    if project_id is not None:
        conds.append(Conversation.project_id == project_id)
    stmt = (
        select(
            Conversation.operator_id,
            func.sum(case((Message.sender_role == UserRole.OPERATOR, 1), else_=0)),
            func.sum(case((Message.sender_role == UserRole.MEMBER, 1), else_=0)),
        )
        .select_from(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(*conds)
        .group_by(Conversation.operator_id)
    )
    for op_id, sent, received in db.execute(stmt).all():
        result[op_id] = MessageStats(sent=int(sent or 0), received=int(received or 0))
    return result


def bulk_response_time_stats(
    db: Session, *, operator_ids: list[int], project_id: int | None, start: datetime, end: datetime
) -> dict[int, ResponseTimeStats]:
    result = {op_id: ResponseTimeStats() for op_id in operator_ids}
    if not operator_ids:
        return result

    next_role = func.lead(Message.sender_role).over(
        partition_by=Message.conversation_id, order_by=Message.created_at
    )
    next_created = func.lead(Message.created_at).over(
        partition_by=Message.conversation_id, order_by=Message.created_at
    )
    conds = [Conversation.type == ConversationType.OPERATOR_MEMBER, Conversation.operator_id.in_(operator_ids)]
    if project_id is not None:
        conds.append(Conversation.project_id == project_id)

    pairs = (
        select(
            Conversation.operator_id.label("operator_id"),
            Message.sender_role.label("sender_role"),
            Message.created_at.label("created_at"),
            next_role.label("next_role"),
            next_created.label("next_created_at"),
        )
        .select_from(Message)
        .join(Conversation, Conversation.id == Message.conversation_id)
        .where(*conds)
        .subquery()
    )
    delta = func.extract("epoch", pairs.c.next_created_at - pairs.c.created_at)
    stmt = (
        select(pairs.c.operator_id, func.avg(delta), func.min(delta), func.max(delta), func.count())
        .where(
            pairs.c.sender_role == UserRole.MEMBER,
            pairs.c.next_role == UserRole.OPERATOR,
            pairs.c.created_at >= start,
            pairs.c.created_at <= end,
        )
        .group_by(pairs.c.operator_id)
    )
    for op_id, avg_s, min_s, max_s, cnt in db.execute(stmt).all():
        result[op_id] = ResponseTimeStats(
            avg_seconds=float(avg_s) if avg_s is not None else None,
            min_seconds=float(min_s) if min_s is not None else None,
            max_seconds=float(max_s) if max_s is not None else None,
            sample_size=int(cnt or 0),
        )
    return result


def bulk_online_status(db: Session, *, operator_ids: list[int]) -> dict[int, bool]:
    """An operator counts as online if they're online in ANY currently-assigned project."""
    result = {op_id: False for op_id in operator_ids}
    if not operator_ids:
        return result
    stmt = (
        select(Presence.user_id, func.bool_or(Presence.is_online))
        .where(Presence.user_id.in_(operator_ids), Presence.is_online.is_(True))
        .group_by(Presence.user_id)
    )
    for op_id, online in db.execute(stmt).all():
        result[op_id] = bool(online)
    return result


def get_workload(db: Session, *, project_id: int | None = None) -> tuple[list[WorkloadOperator], int, int]:
    operator_ids = list_active_operator_ids(db, project_id=project_id)
    if not operator_ids:
        return [], 0, 0

    operators = {u.id: u for u in db.scalars(select(User).where(User.id.in_(operator_ids))).all()}
    online = bulk_online_status(db, operator_ids=operator_ids)

    active_members_stmt = (
        select(MemberAssignment.operator_id, func.count(MemberAssignment.id))
        .where(MemberAssignment.operator_id.in_(operator_ids), MemberAssignment.is_active.is_(True))
    )
    if project_id is not None:
        active_members_stmt = active_members_stmt.where(MemberAssignment.project_id == project_id)
    active_members_stmt = active_members_stmt.group_by(MemberAssignment.operator_id)
    active_members = {op_id: int(cnt) for op_id, cnt in db.execute(active_members_stmt).all()}

    project_count_stmt = (
        select(OperatorAssignment.operator_id, func.count(OperatorAssignment.id))
        .where(OperatorAssignment.operator_id.in_(operator_ids), OperatorAssignment.is_active.is_(True))
        .group_by(OperatorAssignment.operator_id)
    )
    project_counts = {op_id: int(cnt) for op_id, cnt in db.execute(project_count_stmt).all()}

    rows: list[WorkloadOperator] = []
    online_count = 0
    for op_id in operator_ids:
        user = operators.get(op_id)
        if not user:
            continue
        is_online = online.get(op_id, False)
        if is_online:
            online_count += 1
        rows.append(
            WorkloadOperator(
                operator_id=op_id,
                operator_name=user.name,
                operator_uid=user.uid,
                is_online=is_online,
                active_members=active_members.get(op_id, 0),
                assigned_project_count=project_counts.get(op_id, 0),
            )
        )
    rows.sort(key=lambda r: r.operator_name.lower())
    return rows, online_count, len(rows) - online_count
