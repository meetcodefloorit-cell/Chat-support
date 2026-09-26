from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.realtime import broadcast_members_changed_sync
from app.core.deps import ensure_project_access, get_current_user
from app.db.session import get_db
from app.models import User, UserRole
from app.schemas import AssignmentResponse, MemberCreate, UserOut
from app.services import assignment_service

router = APIRouter(tags=["operator"])


def _broadcast_member_change(db: Session, *, project_id: int, reason: str, extra_user_ids: list[int] | None = None) -> None:
    targets = assignment_service.list_project_refresh_target_user_ids(
        db,
        project_id=project_id,
        extra_user_ids=extra_user_ids,
    )
    broadcast_members_changed_sync(project_id=project_id, user_ids=targets, reason=reason)


@router.post("/projects/{project_id}/members", response_model=UserOut)
def create_member(
    project_id: int,
    payload: MemberCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserOut:
    """Member creation is admin-only. Use POST /api/projects/{project_id}/admin/members."""
    ensure_project_access(db, current_user, project_id)
    if current_user.role == UserRole.OPERATOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operators cannot create members. Admins create members via POST /api/projects/{project_id}/admin/members.",
        )
    if current_user.role == UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admins must use POST /api/projects/{project_id}/admin/members with operator_id",
        )
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")


@router.post("/projects/{project_id}/members/{member_id}/assign", response_model=AssignmentResponse)
def assign_member(
    project_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    ensure_project_access(db, current_user, project_id)
    if current_user.role == UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admins must use POST /api/projects/{project_id}/members/{member_id}/assign-operator",
        )
    assignment_service.operator_assign_member(db, project_id=project_id, operator=current_user, member_id=member_id)
    db.commit()
    _broadcast_member_change(db, project_id=project_id, reason="member_assigned", extra_user_ids=[member_id])
    return AssignmentResponse(detail="Member assigned successfully")


@router.delete("/projects/{project_id}/members/{member_id}/remove", response_model=AssignmentResponse)
def remove_member(
    project_id: int,
    member_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    """Removing members from a project is admin-only."""
    ensure_project_access(db, current_user, project_id)
    if current_user.role == UserRole.OPERATOR:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Operators cannot remove members. Use the admin dashboard.",
        )
    if current_user.role == UserRole.ADMIN:
        assignment_service.admin_remove_member_from_project(
            db, project_id=project_id, admin=current_user, member_id=member_id, terminate=False
        )
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed")
    db.commit()
    _broadcast_member_change(db, project_id=project_id, reason="member_removed", extra_user_ids=[member_id])
    return AssignmentResponse(detail="Member removed successfully")
