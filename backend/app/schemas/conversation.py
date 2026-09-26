from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.enums import ConversationType


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    type: ConversationType
    operator_id: int
    member_id: int | None
    admin_id: int | None
    name: str = ""
    created_at: datetime
    unread_count: int = 0
    last_message_at: datetime | None = None


class GroupCreate(BaseModel):
    name: str
    participant_ids: list[int]
