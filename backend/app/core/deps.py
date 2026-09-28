from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import MembershipStatus, OperatorAssignment, Project, ProjectUser, User, UserRole, UserSession

bearer_scheme = HTTPBearer(auto_error=False)


def validate_user_session(db: Session, *, user: User, payload: dict) -> None:
    """
    Role-based session limits:
    - ADMIN: up to 3 active sessions
    - OPERATOR: exactly 1 active session (latest login wins)
    - MEMBER: unrestricted concurrent sessions
    """
    if user.role == UserRole.MEMBER:
        return

    session_token = payload.get("session_token")
    if not session_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please log in again.")

    session = db.scalar(
        select(UserSession).where(
            UserSession.user_id == user.id,
            UserSession.session_token == str(session_token),
        )
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please log in again.")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")

    payload = decode_access_token(credentials.credentials)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    user = db.scalar(select(User).where(User.id == int(user_id)))
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or missing user")

    validate_user_session(db, user=user, payload=payload)

    return user


def require_admin(user: User) -> None:
    if user.role.value != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")


def is_super_admin(user: User) -> bool:
    return user.role == UserRole.ADMIN and user.email.lower() == settings.super_admin_email.lower()


def require_super_admin(user: User) -> None:
    """Only the single super admin (matched by email, see settings.super_admin_email) may
    create/manage other Admin accounts. A regular admin's role or a client-supplied flag
    is never trusted for this check."""
    require_admin(user)
    if not is_super_admin(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin privileges required")


def get_active_project_or_404(db: Session, project_id: int) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id, Project.is_active.is_(True)))
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def ensure_project_access(db: Session, user: User, project_id: int) -> Project:
    # Admin can manage BOTH active and inactive projects (e.g. re-activate a project).
    if user.role.value == "ADMIN":
        project = db.scalar(select(Project).where(Project.id == project_id))
        if not project:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
        return project

    project = get_active_project_or_404(db, project_id)

    if user.role == UserRole.OPERATOR:
        # Operators may be assigned to multiple projects. Access is granted per-project
        # based on an active OperatorAssignment row -- never a "first/only project" cap.
        assignment = db.scalar(
            select(OperatorAssignment).where(
                OperatorAssignment.project_id == project_id,
                OperatorAssignment.operator_id == user.id,
            )
        )
        if assignment is not None and assignment.is_active:
            return project

        # Terminated (not removed) operators keep project-level access so they can still
        # reach the admin-help conversation; conversation_service.assert_conversation_access
        # further restricts them to that single thread.
        terminated_membership = db.scalar(
            select(ProjectUser).where(
                ProjectUser.project_id == project_id,
                ProjectUser.user_id == user.id,
                ProjectUser.role_override == UserRole.OPERATOR,
                ProjectUser.status == MembershipStatus.TERMINATED,
            )
        )
        if terminated_membership is not None:
            return project

        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")

    # Defensive rule (revised scope):
    # Non-admin (member) users should not be able to browse other project IDs directly.
    # We enforce a single active "current project" per member.
    single_project_id = db.scalar(
        select(Project.id)
        .join(ProjectUser, ProjectUser.project_id == Project.id)
        .where(
            ProjectUser.user_id == user.id,
            ProjectUser.status.in_([MembershipStatus.ACTIVE, MembershipStatus.TERMINATED]),
            Project.is_active.is_(True),
        )
        .order_by(Project.id.asc())
        .limit(1)
    )
    if not single_project_id or int(single_project_id) != int(project_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")

    membership = db.scalar(
        select(ProjectUser).where(
            ProjectUser.project_id == project_id,
            ProjectUser.user_id == user.id,
            ProjectUser.status.in_([MembershipStatus.ACTIVE, MembershipStatus.TERMINATED]),
        )
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")

    return project
