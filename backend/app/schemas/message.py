from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import MessageType, UserRole


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=4000)


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    conversation_id: int
    project_id: int
    sender_user_id: int
    sender_role: UserRole
    content: str
    message_type: MessageType
    attachment_url: str | None = None
    attachment_filename: str | None = None
    attachment_mime: str | None = None
    created_at: datetime
    read_by_user_ids: list[int] = []
