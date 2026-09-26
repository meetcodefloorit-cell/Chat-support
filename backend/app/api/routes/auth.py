from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import ensure_project_access, get_current_user
from app.core.config import settings
from app.core.login_rate_limit import check_login_rate_limit
from app.db.session import get_db
from app.models import ProjectUser, User
from app.schemas import LoginRequest, TokenResponse, UserOut
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    check_login_rate_limit(request)
    identifier = payload.get_identifier()
    user = auth_service.authenticate_user(db, identifier, payload.password)
    token = auth_service.build_login_token(db, user)
    out = UserOut.model_validate(user)
    out.is_super_admin = user.role.value == "ADMIN" and user.email.lower() == settings.super_admin_email.lower()
    return TokenResponse(access_token=token, user=out)


@router.get("/me/status/{project_id}")
def get_my_status(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    if current_user.role.value == "ADMIN":
        return {"status": "active"}

    # Route through the centralized project authorization gate so this endpoint cannot be
    # used to probe status for a project the caller has no (or no-longer-active) access to.
    ensure_project_access(db, current_user, project_id)

    membership = db.scalar(
        select(ProjectUser).where(
            ProjectUser.project_id == project_id,
            ProjectUser.user_id == current_user.id,
        )
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not a member of this project")
    return {"status": membership.status.value}
