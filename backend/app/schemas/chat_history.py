from datetime import datetime

from pydantic import BaseModel

from app.schemas.message import MessageOut


class ChatHistoryRow(BaseModel):
    session_id: int
    conversation_id: int
    project_id: int
    project_name: str
    member_id: int
    member_name: str
    member_uid: str
    operator_id: int
    operator_name: str
    operator_uid: str
    started_at: datetime
    assigned_at: datetime
    first_response_at: datetime | None
    closed_at: datetime | None
    duration_seconds: int | None
    status: str


class ChatHistoryPage(BaseModel):
    items: list[ChatHistoryRow]
    total: int
    limit: int
    offset: int


class ChatSessionEventOut(BaseModel):
    event_type: str
    occurred_at: datetime
    detail: str | None = None


class ChatSessionDetailOut(BaseModel):
    session_id: int
    conversation_id: int
    project_id: int
    project_name: str
    member_id: int
    member_name: str
    member_uid: str
    operator_id: int
    operator_name: str
    operator_uid: str
    started_at: datetime
    assigned_at: datetime
    first_response_at: datetime | None
    closed_at: datetime | None
    duration_seconds: int | None
    status: str
    thank_you_present: bool | None
    first_response_sla_met: bool | None
    messages: list[MessageOut]
    events: list[ChatSessionEventOut]
