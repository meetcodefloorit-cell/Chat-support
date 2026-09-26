from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.enums import UserRole


class UserCreate(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=6, max_length=128)
    role: UserRole


class MemberCreate(BaseModel):
    """Used by operators to create and assign a new member in one step."""
    email: EmailStr
    name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=6, max_length=128)


class AdminMemberCreate(BaseModel):
    """Admin creates a member in a project and assigns them to an operator."""
    operator_id: int
    email: EmailStr
    name: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=6, max_length=128)


class PasswordChangeRequest(BaseModel):
    new_password: str = Field(min_length=6, max_length=128)


class SelfPasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class BulkDeactivateUsersRequest(BaseModel):
    user_ids: list[int] = Field(min_length=1)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    uid: str
    email: EmailStr
    name: str
    role: UserRole
    is_super_admin: bool = False
    is_active: bool
    created_at: datetime


class UserOutWithOperator(BaseModel):
    """Member user info extended with their assigned operator details."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    uid: str
    email: EmailStr
    name: str
    role: UserRole
    is_active: bool
    created_at: datetime
    assigned_operator_id: int | None = None
    assigned_operator_name: str | None = None
    assigned_operator_uid: str | None = None
    membership_status: str | None = None


class OperatorAssignOptions(BaseModel):
    """Admin: operators available to assign to this project (not currently assigned)."""

    assignable: list[UserOut]


class UserOutWithMembership(UserOut):
    membership_status: str | None = None
    is_assigned: bool | None = None
