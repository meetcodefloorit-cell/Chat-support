from datetime import datetime

from pydantic import BaseModel


class AnalyticsRange(BaseModel):
    start: datetime
    end: datetime
    granularity: str


class ConversationBreakdown(BaseModel):
    """
    Lifetime, current-state snapshot of an operator's operator<->member conversations.

    - active: member is currently actively assigned to this operator (ongoing thread)
    - reassigned: member's project membership is still active, but they were moved to
      a different operator (this operator's historical thread with them is no longer current)
    - terminated: member's project membership status is TERMINATED (real backend state)
    - removed: member's project membership status is REMOVED (real backend state)

    Not date-filtered -- membership status has no change timestamp in the schema, so this
    can only reflect "right now", never "as of the selected date range".
    """

    active: int = 0
    reassigned: int = 0
    terminated: int = 0
    removed: int = 0

    @property
    def total(self) -> int:
        return self.active + self.reassigned + self.terminated + self.removed


class MessageStats(BaseModel):
    sent: int = 0
    received: int = 0


class ResponseTimeStats(BaseModel):
    """
    Average/min/max time between a member's message and the operator's next reply in the
    same conversation, for member messages sent within the selected date range.
    """

    avg_seconds: float | None = None
    min_seconds: float | None = None
    max_seconds: float | None = None
    sample_size: int = 0


class VolumePoint(BaseModel):
    bucket: datetime
    conversations_started: int = 0
    messages_sent: int = 0
    messages_received: int = 0


class ResponseTimePoint(BaseModel):
    bucket: datetime
    avg_seconds: float | None = None
    sample_size: int = 0


class PresenceStatus(BaseModel):
    project_id: int
    project_name: str
    is_online: bool
    last_seen_at: datetime | None = None


class ConversationRef(BaseModel):
    conversation_id: int
    project_id: int
    project_name: str
    member_id: int
    member_name: str
    member_uid: str
    last_message_at: datetime | None = None


class TimingMetrics(BaseModel):
    """Server-authoritative chat-timing/SLA figures, sourced from ChatSession/OperatorMistake
    rows only (the same tables that drive live enforcement -- never recalculated differently
    for analytics)."""

    total_sessions: int = 0
    completed: int = 0
    missed: int = 0
    abandoned: int = 0
    auto_closed: int = 0
    sla_met: int = 0
    sla_breached: int = 0
    avg_first_response_seconds: float | None = None
    avg_handling_seconds: float | None = None
    missing_thank_you_count: int = 0
    operator_mistake_count: int = 0
    sla_compliance_percent: float | None = None


class OperatorAnalyticsOut(BaseModel):
    operator_id: int
    operator_name: str
    operator_uid: str
    operator_email: str
    range: AnalyticsRange
    project_id: int | None
    conversations_started: int
    conversations: ConversationBreakdown
    messages: MessageStats
    response_time: ResponseTimeStats
    presence: list[PresenceStatus]
    volume_series: list[VolumePoint]
    response_time_series: list[ResponseTimePoint]
    breakdown_refs: dict[str, list[ConversationRef]]
    timing: TimingMetrics


class OperatorSummaryRow(BaseModel):
    operator_id: int
    operator_name: str
    operator_uid: str
    operator_email: str
    is_online: bool
    conversations_started: int
    conversations: ConversationBreakdown
    messages: MessageStats
    response_time: ResponseTimeStats
    timing: TimingMetrics


class AdminOverviewOut(BaseModel):
    range: AnalyticsRange
    project_id: int | None
    conversations_started: int
    conversations: ConversationBreakdown
    messages: MessageStats
    response_time: ResponseTimeStats
    volume_series: list[VolumePoint]
    operators: list[OperatorSummaryRow]
    timing: TimingMetrics


class WorkloadOperator(BaseModel):
    operator_id: int
    operator_name: str
    operator_uid: str
    is_online: bool
    active_members: int
    assigned_project_count: int


class WorkloadOut(BaseModel):
    online_count: int
    offline_count: int
    operators: list[WorkloadOperator]


class MemberAnalyticsOut(BaseModel):
    """Per-customer analytics. `timing`/`messages`/`response_time`/`volume_series` are
    date-range filtered like everywhere else in this module; `first_chat_at`/`last_chat_at`
    are lifetime facts (not range-filtered) shown as profile context, matching how a
    customer's account facts are presented separately from their period activity."""

    member_id: int
    member_name: str
    member_uid: str
    member_email: str
    project_id: int | None
    project_name: str | None
    assigned_operator_id: int | None
    assigned_operator_name: str | None
    account_status: str
    is_active: bool
    range: AnalyticsRange
    active_chats_now: int
    messages: MessageStats
    response_time: ResponseTimeStats
    volume_series: list[VolumePoint]
    response_time_series: list[ResponseTimePoint]
    timing: TimingMetrics
    first_chat_at: datetime | None
    last_chat_at: datetime | None


class ProjectAnalyticsOut(BaseModel):
    project_id: int
    project_name: str
    range: AnalyticsRange
    conversations_started: int
    conversations: ConversationBreakdown
    messages: MessageStats
    response_time: ResponseTimeStats
    operators: list[OperatorSummaryRow]
    timing: TimingMetrics
