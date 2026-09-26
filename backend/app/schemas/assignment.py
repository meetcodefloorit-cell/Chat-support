from typing import Literal
from pydantic import BaseModel, Field


class AssignmentResponse(BaseModel):
    success: bool = True
    detail: str


class BulkConversationClearRequest(BaseModel):
    conversation_ids: list[int] = Field(min_length=1)


class BroadcastRequest(BaseModel):
    member_ids: list[int] | None = None
    all_members: bool = False
    operator_ids: list[int] | None = None
    all_operators: bool = False
    content: str = Field(min_length=1, max_length=4000)
    delivery_method: Literal["chat", "notification"] = "chat"


class BroadcastResponse(BaseModel):
    success: bool = True
    detail: str
    messages_created: int


class MemberReassignRequest(BaseModel):
    operator_id: int
