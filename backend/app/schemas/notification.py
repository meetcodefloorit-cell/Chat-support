from datetime import datetime

from pydantic import BaseModel, ConfigDict


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    user_id: int
    kind: str
    reference_id: int | None
    title: str
    read_at: datetime | None
    created_at: datetime
