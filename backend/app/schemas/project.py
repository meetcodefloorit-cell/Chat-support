from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


class ProjectCreate(BaseModel):
    name: str
    logo_url: str | None = None
    operator_terminated_message: str | None = None
    support_email: EmailStr | None = None
    support_phone: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    logo_url: str | None = None
    operator_terminated_message: str | None = None
    support_email: EmailStr | None = None
    support_phone: str | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    logo_url: str | None
    operator_terminated_message: str | None = None
    support_email: str | None = None
    support_phone: str | None = None
    is_active: bool
    created_at: datetime
