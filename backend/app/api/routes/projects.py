import os
import uuid

from fastapi import APIRouter, Depends, Query, UploadFile, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.deps import ensure_project_access, get_current_user, require_admin
from app.core.paths import UPLOADS_DIR
from app.core.websocket_manager import manager
from app.db.session import get_db
from app.models import MemberAssignment, Project, User, UserRole
from app.schemas import (
    NotificationOut,
    OperatorAssignOptions,
    PresenceOut,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    UserOut,
    UserOutWithMembership,
    UserOutWithOperator,
)
from app.services import assignment_service, notification_service, presence_service, project_service

UPLOAD_DIR = UPLOADS_DIR
os.makedirs(UPLOAD_DIR, exist_ok=True)

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> list[ProjectOut]:
    projects = project_service.list_projects_for_user(db, current_user)
    return [ProjectOut.model_validate(project) for project in projects]


@router.post("", response_model=ProjectOut)
def create_project(
    payload: ProjectCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectOut:
    require_admin(current_user)
    project = project_service.create_project(db, payload, current_user)
    db.commit()
    db.refresh(project)
    return ProjectOut.model_validate(project)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectOut:
    require_admin(current_user)
    project = db.scalar(select(Project).where(Project.id == project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project = project_service.update_project(project, payload)
    db.commit()
    db.refresh(project)
    return ProjectOut.model_validate(project)


@router.patch("/{project_id}/deactivate", response_model=ProjectOut)
def deactivate_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectOut:
    """Deactivate a project. Admin only."""
    require_admin(current_user)
    project = db.scalar(select(Project).where(Project.id == project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.is_active = False
    db.commit()
    db.refresh(project)
    return ProjectOut.model_validate(project)


@router.patch("/{project_id}/activate", response_model=ProjectOut)
def activate_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ProjectOut:
    """Re-activate a previously deactivated project. Admin only."""
    require_admin(current_user)
    project = db.scalar(select(Project).where(Project.id == project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.is_active = True
    db.commit()
    db.refresh(project)
    return ProjectOut.model_validate(project)


MAX_LOGO_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"}
ALLOWED_MIME_TYPES = {
    "image/png", "image/jpeg", "image/svg+xml", "image/webp", "image/gif",
}


@router.post("/{project_id}/logo")
def upload_project_logo(
    project_id: int,
    file: UploadFile,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JSONResponse:
    require_admin(current_user)
    project = db.scalar(select(Project).where(Project.id == project_id))
    if not project:
        return JSONResponse(status_code=404, content={"detail": "Project not found"})

    ext = os.path.splitext(file.filename or "logo.png")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return JSONResponse(status_code=400, content={"detail": "Unsupported file type"})

    ct = file.content_type or ""
    if ct and ct not in ALLOWED_MIME_TYPES:
        return JSONResponse(status_code=400, content={"detail": f"Unsupported MIME type: {file.content_type}"})

    contents = file.file.read(MAX_LOGO_SIZE + 1)
    if len(contents) > MAX_LOGO_SIZE:
        return JSONResponse(status_code=400, content={"detail": "File too large. Maximum size is 10 MB."})

    old_logo_url = project.logo_url

    safe_name = f"logo_{project_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(UPLOAD_DIR, safe_name)

    with open(filepath, "wb") as f:
        f.write(contents)

    if old_logo_url:
        old_filename = old_logo_url.rsplit("/", 1)[-1]
        old_filepath = os.path.join(UPLOAD_DIR, old_filename)
        if os.path.isfile(old_filepath) and old_filepath != filepath:
            try:
                os.remove(old_filepath)
            except OSError:
                pass

    logo_url = f"/api/uploads/{safe_name}"
    project.logo_url = logo_url
    db.commit()
    db.refresh(project)
    return JSONResponse(content={"logo_url": logo_url, "detail": "Logo uploaded"})


@router.delete("/{project_id}/logo")
def delete_project_logo(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JSONResponse:
    """Admin/Super Admin only: remove the current project logo (operators get 403)."""
    require_admin(current_user)
    project = db.scalar(select(Project).where(Project.id == project_id))
    if not project:
        return JSONResponse(status_code=404, content={"detail": "Project not found"})

    old_logo_url = project.logo_url
    if old_logo_url:
        old_filename = old_logo_url.rsplit("/", 1)[-1]
        old_filepath = os.path.join(UPLOAD_DIR, old_filename)
        if os.path.isfile(old_filepath):
            try:
                os.remove(old_filepath)
            except OSError:
                pass

    project.logo_url = None
    db.commit()
    db.refresh(project)
    return JSONResponse(content={"detail": "Logo removed"})


@router.get("/{project_id}/operators/assign-options", response_model=OperatorAssignOptions)
def list_operator_assign_options(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> OperatorAssignOptions:
    """Admin: operators available to assign vs removed from project (restore list)."""
    ensure_project_access(db, current_user, project_id)
    require_admin(current_user)
    assignable = assignment_service.list_operators_assignable_to_project(db, project_id=project_id)
    return OperatorAssignOptions(assignable=[UserOut.model_validate(u) for u in assignable])


@router.get("/{project_id}/operators", response_model=list[UserOut])
def list_operators(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserOut]:
    ensure_project_access(db, current_user, project_id)
    if current_user.role == UserRole.MEMBER:
        users = assignment_service.list_member_operators(db, project_id=project_id, member_id=current_user.id)
    else:
        require_admin(current_user)
        users = assignment_service.list_project_operators(db, project_id=project_id)
    return [UserOut.model_validate(user) for user in users]


@router.get("/{project_id}/operators-with-status", response_model=list[UserOutWithMembership])
def list_operators_with_status(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserOutWithMembership]:
    ensure_project_access(db, current_user, project_id)
    require_admin(current_user)
    rows = assignment_service.list_project_operators_with_status(db, project_id=project_id)
    return [UserOutWithMembership(**row) for row in rows]


@router.get("/{project_id}/members", response_model=list[UserOut])
def list_members(
    project_id: int,
    for_assign: bool = Query(default=False, description="If true, operator gets all project members for assign dropdown"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserOut]:
    ensure_project_access(db, current_user, project_id)
    users = assignment_service.list_project_members(
        db, project_id=project_id, viewer=current_user, for_assign=for_assign
    )
    return [UserOut.model_validate(user) for user in users]


@router.get("/{project_id}/members-with-operators", response_model=list[UserOutWithOperator])
def list_members_with_operators(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[UserOutWithOperator]:
    """
    Admin only. Returns all active members in the project with their assigned operator info.
    Used to display 'Assigned to: [Operator Name]' in the admin Members panel.
    """
    require_admin(current_user)
    ensure_project_access(db, current_user, project_id)
    rows = assignment_service.list_project_members_with_operators(db, project_id=project_id)
    return [UserOutWithOperator(**row) for row in rows]


@router.get("/{project_id}/my-operator", response_model=UserOut | None)
def get_my_operator(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserOut | None:
    """
    Member only. Returns the operator this member is assigned to in this project.
    Returns null if no assignment found (should not happen if login was allowed).
    """
    ensure_project_access(db, current_user, project_id)
    if current_user.role != UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Members only")

    assignment = db.scalar(
        select(MemberAssignment).where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.member_id == current_user.id,
            MemberAssignment.is_active.is_(True),
        )
    )
    if not assignment:
        return None

    operator = db.scalar(select(User).where(User.id == assignment.operator_id, User.is_active.is_(True)))
    if not operator:
        return None
    return UserOut.model_validate(operator)


@router.get("/{project_id}/presence", response_model=list[PresenceOut])
def list_presence(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PresenceOut]:
    ensure_project_access(db, current_user, project_id)
    records = presence_service.get_visible_presence(db, project_id=project_id, viewer=current_user)
    return [
        PresenceOut(
            user_id=item.user_id,
            project_id=item.project_id,
            is_online=item.is_online,
            last_seen_at=item.last_seen_at,
        )
        for item in records
    ]


@router.get("/{project_id}/notifications", response_model=list[NotificationOut])
def list_notifications(
    project_id: int,
    limit: int = Query(default=30, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    unread_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[NotificationOut]:
    ensure_project_access(db, current_user, project_id)
    items = notification_service.list_notifications(
        db, project_id=project_id, user_id=current_user.id, limit=limit, offset=offset, unread_only=unread_only
    )
    return [NotificationOut.model_validate(n) for n in items]


@router.get("/{project_id}/notifications/unread-count")
def get_unread_notification_count(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    ensure_project_access(db, current_user, project_id)
    count = notification_service.count_unread(db, project_id=project_id, user_id=current_user.id)
    return {"count": count}


@router.patch("/{project_id}/notifications/read")
async def mark_notifications_read(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    ensure_project_access(db, current_user, project_id)
    count = notification_service.mark_all_read(db, project_id=project_id, user_id=current_user.id)
    db.commit()
    unread = notification_service.count_unread(db, project_id=project_id, user_id=current_user.id)
    await manager.broadcast_to_users(
        project_id,
        [current_user.id],
        {"event": "notification:count", "data": {"count": unread}},
    )
    return {"marked": count}


@router.patch("/{project_id}/notifications/{notification_id}/read")
async def mark_notification_read(
    project_id: int,
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    ensure_project_access(db, current_user, project_id)
    ok = notification_service.mark_read(db, notification_id=notification_id, user_id=current_user.id)
    db.commit()
    unread = notification_service.count_unread(db, project_id=project_id, user_id=current_user.id)
    await manager.broadcast_to_users(
        project_id,
        [current_user.id],
        {"event": "notification:count", "data": {"count": unread}},
    )
    return {"marked": 1 if ok else 0}


@router.delete("/{project_id}")
def delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Soft-delete project (archive): keep users/accounts and historical memberships intact.
    """
    require_admin(current_user)
    project = db.scalar(select(Project).where(Project.id == project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    project.is_active = False
    db.commit()
    return {"detail": "Project deleted (archived)"}


@router.delete("/{project_id}/permanent")
def permanently_delete_project(
    project_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """
    Permanently delete an archived project.
    Keeps user accounts; only project-scoped rows are removed via DB cascades.
    """
    require_admin(current_user)
    project = db.scalar(select(Project).where(Project.id == project_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.is_active:
        raise HTTPException(status_code=400, detail="Archive the project first before permanent delete")
    db.delete(project)
    db.commit()
    return {"detail": "Project permanently deleted"}
