from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import ensure_project_access, get_current_user, require_admin
from app.db.session import get_db
from app.models import MemberAssignment, Project, ProjectUser, User, UserRole
from app.schemas.analytics import (
    AdminOverviewOut,
    MemberAnalyticsOut,
    OperatorAnalyticsOut,
    OperatorSummaryRow,
    ProjectAnalyticsOut,
    TimingMetrics,
    WorkloadOut,
)
from app.schemas.presence import PresenceAnalyticsOut, PresenceHistoryEvent
from app.services import analytics_service, chat_session_service, presence_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _aggregate_timing(rows: list[TimingMetrics]) -> TimingMetrics:
    total = sum(r.total_sessions for r in rows)
    completed = sum(r.completed for r in rows)
    abandoned = sum(r.abandoned for r in rows)
    auto_closed = sum(r.auto_closed for r in rows)
    sla_met = sum(r.sla_met for r in rows)
    sla_breached = sum(r.sla_breached for r in rows)
    missing_thank_you = sum(r.missing_thank_you_count for r in rows)
    mistakes = sum(r.operator_mistake_count for r in rows)

    fr_samples = [(r.avg_first_response_seconds, r.sla_met + r.sla_breached) for r in rows if r.avg_first_response_seconds is not None]
    avg_first_response = None
    fr_weight = sum(w for _, w in fr_samples if w > 0)
    if fr_weight > 0:
        avg_first_response = sum(v * w for v, w in fr_samples if w > 0) / fr_weight
    elif fr_samples:
        avg_first_response = sum(v for v, _ in fr_samples) / len(fr_samples)

    handle_samples = [(r.avg_handling_seconds, r.completed) for r in rows if r.avg_handling_seconds is not None]
    avg_handling = None
    handle_weight = sum(w for _, w in handle_samples if w > 0)
    if handle_weight > 0:
        avg_handling = sum(v * w for v, w in handle_samples if w > 0) / handle_weight
    elif handle_samples:
        avg_handling = sum(v for v, _ in handle_samples) / len(handle_samples)

    resolved = sla_met + sla_breached
    return TimingMetrics(
        total_sessions=total,
        completed=completed,
        missed=sla_breached,
        abandoned=abandoned,
        auto_closed=auto_closed,
        sla_met=sla_met,
        sla_breached=sla_breached,
        avg_first_response_seconds=avg_first_response,
        avg_handling_seconds=avg_handling,
        missing_thank_you_count=missing_thank_you,
        operator_mistake_count=mistakes,
        sla_compliance_percent=round(sla_met / resolved * 100, 1) if resolved > 0 else None,
    )


def _validate_granularity(granularity: str | None) -> str | None:
    if granularity is not None and granularity not in analytics_service.GRANULARITIES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="granularity must be one of: hour, day, week")
    return granularity


def _get_operator_or_404(db: Session, operator_id: int) -> User:
    operator = db.scalar(select(User).where(User.id == operator_id, User.role == UserRole.OPERATOR))
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operator not found")
    return operator


def _get_member_or_404(db: Session, member_id: int) -> User:
    member = db.scalar(select(User).where(User.id == member_id, User.role == UserRole.MEMBER))
    if not member:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    return member


def _build_operator_analytics(
    db: Session, *, operator: User, project_id: int | None, start_date: datetime | None, end_date: datetime | None, granularity: str | None
) -> OperatorAnalyticsOut:
    rng = analytics_service.normalize_range(start_date, end_date, granularity)
    conv_ids = analytics_service.operator_conversation_ids(db, operator_id=operator.id, project_id=project_id)

    conversations, refs = analytics_service.get_operator_conversation_detail(
        db, operator_id=operator.id, project_id=project_id
    )
    conversations_started = analytics_service.get_conversations_started(
        db, operator_id=operator.id, project_id=project_id, start=rng.start, end=rng.end
    )
    messages = analytics_service.get_message_stats(db, conversation_ids=conv_ids, start=rng.start, end=rng.end)
    response_time = analytics_service.get_response_time_stats(db, conversation_ids=conv_ids, start=rng.start, end=rng.end)
    response_time_series = analytics_service.get_response_time_series(
        db, conversation_ids=conv_ids, start=rng.start, end=rng.end, granularity=rng.granularity
    )
    volume_series = analytics_service.get_volume_series(
        db,
        operator_id=operator.id,
        project_id=project_id,
        conversation_ids=conv_ids,
        start=rng.start,
        end=rng.end,
        granularity=rng.granularity,
    )
    presence = analytics_service.get_operator_presence(db, operator_id=operator.id, project_id=project_id)
    timing = TimingMetrics(
        **chat_session_service.get_operator_timing_metrics(
            db, operator_id=operator.id, project_id=project_id, start=rng.start, end=rng.end
        )
    )

    return OperatorAnalyticsOut(
        operator_id=operator.id,
        operator_name=operator.name,
        operator_uid=operator.uid,
        operator_email=operator.email,
        range=rng,
        project_id=project_id,
        conversations_started=conversations_started,
        conversations=conversations,
        messages=messages,
        response_time=response_time,
        presence=presence,
        volume_series=volume_series,
        response_time_series=response_time_series,
        breakdown_refs=refs,
        timing=timing,
    )


@router.get("/operator/me", response_model=OperatorAnalyticsOut)
def get_my_analytics(
    project_id: int | None = Query(default=None),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    granularity: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OperatorAnalyticsOut:
    if current_user.role != UserRole.OPERATOR:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator role required")
    granularity = _validate_granularity(granularity)
    if project_id is not None:
        ensure_project_access(db, current_user, project_id)
    return _build_operator_analytics(
        db, operator=current_user, project_id=project_id, start_date=start_date, end_date=end_date, granularity=granularity
    )


@router.get("/operator/{operator_id}", response_model=OperatorAnalyticsOut)
def get_operator_analytics(
    operator_id: int,
    project_id: int | None = Query(default=None),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    granularity: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OperatorAnalyticsOut:
    require_admin(current_user)
    granularity = _validate_granularity(granularity)
    operator = _get_operator_or_404(db, operator_id)
    if project_id is not None:
        ensure_project_access(db, current_user, project_id)
    return _build_operator_analytics(
        db, operator=operator, project_id=project_id, start_date=start_date, end_date=end_date, granularity=granularity
    )


@router.get("/member/{member_id}", response_model=MemberAnalyticsOut)
def get_member_analytics(
    member_id: int,
    project_id: int | None = Query(default=None),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    granularity: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MemberAnalyticsOut:
    """Admin/Super Admin only -- per-customer analytics, built from the same
    ChatSession/Conversation/Message tables as everywhere else in this module."""
    require_admin(current_user)
    granularity = _validate_granularity(granularity)
    member = _get_member_or_404(db, member_id)

    # Resolve which project this customer's figures are scoped to: an explicit project_id is
    # verified via the normal access gate; otherwise fall back to their most recent project
    # membership row, mirroring how a member account is always created inside one project.
    if project_id is not None:
        ensure_project_access(db, current_user, project_id)
        membership = db.scalar(
            select(ProjectUser).where(ProjectUser.project_id == project_id, ProjectUser.user_id == member_id)
        )
    else:
        membership = db.scalar(
            select(ProjectUser).where(ProjectUser.user_id == member_id).order_by(ProjectUser.created_at.desc()).limit(1)
        )
        project_id = membership.project_id if membership else None

    project = db.scalar(select(Project).where(Project.id == project_id)) if project_id is not None else None

    assignment = None
    if project_id is not None:
        assignment = db.scalar(
            select(MemberAssignment).where(
                MemberAssignment.project_id == project_id,
                MemberAssignment.member_id == member_id,
                MemberAssignment.is_active.is_(True),
            )
        )
    assigned_operator = db.scalar(select(User).where(User.id == assignment.operator_id)) if assignment else None

    if membership is not None:
        account_status = membership.status.value
    else:
        account_status = "active" if member.is_active else "inactive"

    rng = analytics_service.normalize_range(start_date, end_date, granularity)
    conv_ids = analytics_service.member_conversation_ids(db, member_id=member.id, project_id=project_id)

    messages = analytics_service.get_message_stats(db, conversation_ids=conv_ids, start=rng.start, end=rng.end)
    response_time = analytics_service.get_response_time_stats(db, conversation_ids=conv_ids, start=rng.start, end=rng.end)
    response_time_series = analytics_service.get_response_time_series(
        db, conversation_ids=conv_ids, start=rng.start, end=rng.end, granularity=rng.granularity
    )
    volume_series = analytics_service.get_member_volume_series(
        db,
        member_id=member.id,
        project_id=project_id,
        conversation_ids=conv_ids,
        start=rng.start,
        end=rng.end,
        granularity=rng.granularity,
    )
    timing = TimingMetrics(
        **chat_session_service.get_member_timing_metrics(
            db, member_id=member.id, project_id=project_id, start=rng.start, end=rng.end
        )
    )
    active_chats_now = chat_session_service.get_member_active_chats_now(db, member_id=member.id, project_id=project_id)
    first_chat_at, last_chat_at = chat_session_service.get_member_first_last_chat(
        db, member_id=member.id, project_id=project_id
    )

    return MemberAnalyticsOut(
        member_id=member.id,
        member_name=member.name,
        member_uid=member.uid,
        member_email=member.email,
        project_id=project_id,
        project_name=project.name if project else None,
        assigned_operator_id=assigned_operator.id if assigned_operator else None,
        assigned_operator_name=assigned_operator.name if assigned_operator else None,
        account_status=account_status,
        is_active=member.is_active,
        range=rng,
        active_chats_now=active_chats_now,
        messages=messages,
        response_time=response_time,
        volume_series=volume_series,
        response_time_series=response_time_series,
        timing=timing,
        first_chat_at=first_chat_at,
        last_chat_at=last_chat_at,
    )


@router.get("/operator/{operator_id}/presence-history", response_model=list[PresenceHistoryEvent])
def get_operator_presence_history(
    operator_id: int,
    project_id: int | None = Query(default=None),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PresenceHistoryEvent]:
    """Admin/Super Admin only -- row-per-event online/offline history for one operator."""
    require_admin(current_user)
    operator = _get_operator_or_404(db, operator_id)
    if project_id is not None:
        ensure_project_access(db, current_user, project_id)
    rng = analytics_service.normalize_range(start_date, end_date, None)
    rows = presence_service.list_presence_history(
        db, operator_id=operator.id, project_id=project_id, start=rng.start, end=rng.end
    )
    return [PresenceHistoryEvent(**row) for row in rows]


@router.get("/operator/{operator_id}/presence-analytics", response_model=PresenceAnalyticsOut)
def get_operator_presence_analytics(
    operator_id: int,
    project_id: int | None = Query(default=None),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> PresenceAnalyticsOut:
    """Admin/Super Admin only -- aggregated presence figures for one operator over a range."""
    require_admin(current_user)
    operator = _get_operator_or_404(db, operator_id)
    if project_id is not None:
        ensure_project_access(db, current_user, project_id)
    rng = analytics_service.normalize_range(start_date, end_date, None)
    data = presence_service.get_presence_analytics(
        db, operator_id=operator.id, project_id=project_id, start=rng.start, end=rng.end
    )
    return PresenceAnalyticsOut(
        operator_id=operator.id,
        operator_name=operator.name,
        operator_uid=operator.uid,
        project_id=project_id,
        range=rng,
        **data,
    )


@router.get("/operators", response_model=list[OperatorSummaryRow])
def list_operators_analytics(
    project_id: int | None = Query(default=None),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[OperatorSummaryRow]:
    require_admin(current_user)
    if project_id is not None:
        ensure_project_access(db, current_user, project_id)
    rng = analytics_service.normalize_range(start_date, end_date, None)

    operator_ids = analytics_service.list_active_operator_ids(db, project_id=project_id)
    if not operator_ids:
        return []
    operators = {u.id: u for u in db.scalars(select(User).where(User.id.in_(operator_ids))).all()}

    breakdown = analytics_service.bulk_conversation_breakdown(db, operator_ids=operator_ids, project_id=project_id)
    started = analytics_service.bulk_conversations_started(
        db, operator_ids=operator_ids, project_id=project_id, start=rng.start, end=rng.end
    )
    messages = analytics_service.bulk_message_stats(
        db, operator_ids=operator_ids, project_id=project_id, start=rng.start, end=rng.end
    )
    response_times = analytics_service.bulk_response_time_stats(
        db, operator_ids=operator_ids, project_id=project_id, start=rng.start, end=rng.end
    )
    online = analytics_service.bulk_online_status(db, operator_ids=operator_ids)
    timing_by_op = chat_session_service.bulk_operator_timing_metrics(
        db, operator_ids=operator_ids, project_id=project_id, start=rng.start, end=rng.end
    )

    rows: list[OperatorSummaryRow] = []
    for op_id in operator_ids:
        user = operators.get(op_id)
        if not user:
            continue
        rows.append(
            OperatorSummaryRow(
                operator_id=op_id,
                operator_name=user.name,
                operator_uid=user.uid,
                operator_email=user.email,
                is_online=online.get(op_id, False),
                conversations_started=started.get(op_id, 0),
                conversations=breakdown.get(op_id, analytics_service.ConversationBreakdown()),
                messages=messages.get(op_id, analytics_service.MessageStats()),
                response_time=response_times.get(op_id, analytics_service.ResponseTimeStats()),
                timing=TimingMetrics(**timing_by_op.get(op_id, {})),
            )
        )
    rows.sort(key=lambda r: r.operator_name.lower())
    return rows


@router.get("/overview", response_model=AdminOverviewOut)
def get_overview(
    project_id: int | None = Query(default=None),
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    granularity: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AdminOverviewOut:
    require_admin(current_user)
    granularity = _validate_granularity(granularity)
    if project_id is not None:
        ensure_project_access(db, current_user, project_id)
    rng = analytics_service.normalize_range(start_date, end_date, granularity)

    operator_ids = analytics_service.list_active_operator_ids(db, project_id=project_id)
    operators_rows = list_operators_analytics(
        project_id=project_id,
        start_date=start_date,
        end_date=end_date,
        db=db,
        current_user=current_user,
    )

    totals_breakdown = analytics_service.ConversationBreakdown()
    totals_messages = analytics_service.MessageStats()
    total_started = 0
    for row in operators_rows:
        totals_breakdown.active += row.conversations.active
        totals_breakdown.reassigned += row.conversations.reassigned
        totals_breakdown.terminated += row.conversations.terminated
        totals_breakdown.removed += row.conversations.removed
        totals_messages.sent += row.messages.sent
        totals_messages.received += row.messages.received
        total_started += row.conversations_started

    response_times = analytics_service.bulk_response_time_stats(
        db, operator_ids=operator_ids, project_id=project_id, start=rng.start, end=rng.end
    )
    all_seconds_avg = [r.avg_seconds for r in response_times.values() if r.avg_seconds is not None]
    all_samples = sum(r.sample_size for r in response_times.values())
    weighted_avg = None
    if all_samples > 0:
        weighted_sum = sum((r.avg_seconds or 0) * r.sample_size for r in response_times.values())
        weighted_avg = weighted_sum / all_samples
    overall_response_time = analytics_service.ResponseTimeStats(
        avg_seconds=weighted_avg,
        min_seconds=min((r.min_seconds for r in response_times.values() if r.min_seconds is not None), default=None),
        max_seconds=max((r.max_seconds for r in response_times.values() if r.max_seconds is not None), default=None),
        sample_size=all_samples,
    )

    volume_buckets: dict = {}
    for op_id in operator_ids:
        conv_ids = analytics_service.operator_conversation_ids(db, operator_id=op_id, project_id=project_id)
        series = analytics_service.get_volume_series(
            db,
            operator_id=op_id,
            project_id=project_id,
            conversation_ids=conv_ids,
            start=rng.start,
            end=rng.end,
            granularity=rng.granularity,
        )
        for point in series:
            agg = volume_buckets.setdefault(point.bucket, analytics_service.VolumePoint(bucket=point.bucket))
            agg.conversations_started += point.conversations_started
            agg.messages_sent += point.messages_sent
            agg.messages_received += point.messages_received

    return AdminOverviewOut(
        range=rng,
        project_id=project_id,
        conversations_started=total_started,
        conversations=totals_breakdown,
        messages=totals_messages,
        response_time=overall_response_time,
        volume_series=[volume_buckets[k] for k in sorted(volume_buckets.keys())],
        operators=operators_rows,
        timing=_aggregate_timing([row.timing for row in operators_rows]),
    )


@router.get("/projects/{project_id}", response_model=ProjectAnalyticsOut)
def get_project_analytics(
    project_id: int,
    start_date: datetime | None = Query(default=None),
    end_date: datetime | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectAnalyticsOut:
    require_admin(current_user)
    project = ensure_project_access(db, current_user, project_id)
    rng = analytics_service.normalize_range(start_date, end_date, None)

    operators_rows = list_operators_analytics(
        project_id=project_id,
        start_date=start_date,
        end_date=end_date,
        db=db,
        current_user=current_user,
    )

    totals_breakdown = analytics_service.ConversationBreakdown()
    totals_messages = analytics_service.MessageStats()
    total_started = 0
    for row in operators_rows:
        totals_breakdown.active += row.conversations.active
        totals_breakdown.reassigned += row.conversations.reassigned
        totals_breakdown.terminated += row.conversations.terminated
        totals_breakdown.removed += row.conversations.removed
        totals_messages.sent += row.messages.sent
        totals_messages.received += row.messages.received
        total_started += row.conversations_started

    operator_ids = [row.operator_id for row in operators_rows]
    response_times = analytics_service.bulk_response_time_stats(
        db, operator_ids=operator_ids, project_id=project_id, start=rng.start, end=rng.end
    )
    all_samples = sum(r.sample_size for r in response_times.values())
    weighted_avg = None
    if all_samples > 0:
        weighted_sum = sum((r.avg_seconds or 0) * r.sample_size for r in response_times.values())
        weighted_avg = weighted_sum / all_samples
    overall_response_time = analytics_service.ResponseTimeStats(
        avg_seconds=weighted_avg,
        min_seconds=min((r.min_seconds for r in response_times.values() if r.min_seconds is not None), default=None),
        max_seconds=max((r.max_seconds for r in response_times.values() if r.max_seconds is not None), default=None),
        sample_size=all_samples,
    )

    return ProjectAnalyticsOut(
        project_id=project.id,
        project_name=project.name,
        range=rng,
        conversations_started=total_started,
        conversations=totals_breakdown,
        messages=totals_messages,
        response_time=overall_response_time,
        operators=operators_rows,
        timing=_aggregate_timing([row.timing for row in operators_rows]),
    )


@router.get("/workload", response_model=WorkloadOut)
def get_workload(
    project_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> WorkloadOut:
    require_admin(current_user)
    if project_id is not None:
        ensure_project_access(db, current_user, project_id)
    operators, online_count, offline_count = analytics_service.get_workload(db, project_id=project_id)
    return WorkloadOut(online_count=online_count, offline_count=offline_count, operators=operators)
