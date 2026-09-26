from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from app.core.config import settings
from app.core.deps import get_current_user
from app.core.security import hash_password, verify_password
from app.db.session import get_db
from app.models import MemberAssignment, User, UserRole
from app.schemas import SelfPasswordChangeRequest, UserOut
from app.services import assignment_service
from sqlalchemy.orm import Session

router = APIRouter(tags=["users"])


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)) -> UserOut:
    out = UserOut.model_validate(current_user)
    out.is_super_admin = current_user.role == UserRole.ADMIN and current_user.email.lower() == settings.super_admin_email.lower()
    return out


@router.patch("/me/password")
def change_my_password(
    payload: SelfPasswordChangeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if not verify_password(payload.current_password, current_user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    current_user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"detail": "Password updated successfully"}


@router.get("/users", response_model=list[UserOut])
def list_users(
    role: UserRole = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserOut]:
    if current_user.role == UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Members cannot list users")

    if current_user.role == UserRole.OPERATOR and role != UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operators can only list members")

    if current_user.role == UserRole.OPERATOR:
        # Operators must only see members assigned to them, never every member across
        # every project (would otherwise leak members from projects they aren't assigned to).
        stmt = (
            select(User)
            .join(MemberAssignment, MemberAssignment.member_id == User.id)
            .where(
                MemberAssignment.operator_id == current_user.id,
                MemberAssignment.is_active.is_(True),
                User.is_active.is_(True),
            )
            .distinct()
            .order_by(User.id.asc())
        )
        users = list(db.scalars(stmt).all())
        return [UserOut.model_validate(item) for item in users]

    users = assignment_service.list_users_by_role(db, role=role)
    return [UserOut.model_validate(item) for item in users]
