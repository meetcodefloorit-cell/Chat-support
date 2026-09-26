from datetime import datetime

from pydantic import BaseModel

from app.schemas.analytics import AnalyticsRange


class PresenceOut(BaseModel):
    user_id: int
    project_id: int
    is_online: bool
    last_seen_at: datetime | None


class PresenceHistoryEvent(BaseModel):
    """One row of the Activity / Presence History table. `duration_seconds` is only ever
    populated on an ONLINE row (the length of that online segment, completed or still
    running); OFFLINE rows carry no duration, matching how the feature reads to admins."""

    id: int
    user_id: int
    project_id: int
    project_name: str
    event_type: str  # "online" | "offline"
    occurred_at: datetime
    duration_seconds: int | None = None
    is_ongoing: bool = False


class PresenceAnalyticsOut(BaseModel):
    operator_id: int
    operator_name: str
    operator_uid: str
    project_id: int | None
    range: AnalyticsRange
    is_online: bool
    total_online_seconds: int
    total_offline_seconds: int
    session_count: int
    first_login_at: datetime | None
    last_logout_at: datetime | None
    active_session_seconds: int | None
