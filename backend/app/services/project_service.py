from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import MembershipStatus, OperatorAssignment, Project, ProjectUser, User, UserRole
from app.schemas.project import ProjectCreate, ProjectUpdate


def upsert_project_membership(
    db: Session,
    *,
    project_id: int,
    user_id: int,
    role_override: UserRole | None = None,
    status: MembershipStatus = MembershipStatus.ACTIVE,
) -> ProjectUser:
    membership = db.scalar(
        select(ProjectUser).where(ProjectUser.project_id == project_id, ProjectUser.user_id == user_id)
    )
    if membership:
        membership.status = status
        membership.role_override = role_override
        return membership

    membership = ProjectUser(
        project_id=project_id,
        user_id=user_id,
        role_override=role_override,
        status=status,
    )
    db.add(membership)
    return membership


def list_projects_for_user(db: Session, user: User) -> list[Project]:
    if user.role == UserRole.ADMIN:
        # Admin can see all projects (active + inactive) for management.
        return list(db.scalars(select(Project).order_by(Project.id.asc())).all())

    if user.role == UserRole.OPERATOR:
        # Operators may be assigned to multiple projects: return every active project with
        # an active OperatorAssignment for this operator -- never a "first project" cap.
        stmt = (
            select(Project)
            .join(OperatorAssignment, OperatorAssignment.project_id == Project.id)
            .where(
                Project.is_active.is_(True),
                OperatorAssignment.operator_id == user.id,
                OperatorAssignment.is_active.is_(True),
            )
            .order_by(Project.id.asc())
        )
        projects = list(db.scalars(stmt).all())

        # Preserve terminated-operator visibility (help-channel access) for projects not
        # already included above, matching ensure_project_access's terminated-operator branch.
        seen_ids = {p.id for p in projects}
        terminated_stmt = (
            select(Project)
            .join(ProjectUser, ProjectUser.project_id == Project.id)
            .where(
                Project.is_active.is_(True),
                ProjectUser.user_id == user.id,
                ProjectUser.role_override == UserRole.OPERATOR,
                ProjectUser.status == MembershipStatus.TERMINATED,
            )
            .order_by(Project.id.asc())
        )
        for project in db.scalars(terminated_stmt).all():
            if project.id not in seen_ids:
                projects.append(project)
                seen_ids.add(project.id)
        return projects

    # Members operate in a single visible project context (the first active one by ID) --
    # unchanged, existing behavior.
    stmt = (
        select(Project)
        .join(ProjectUser, ProjectUser.project_id == Project.id)
        .where(
            Project.is_active.is_(True),
            ProjectUser.user_id == user.id,
            ProjectUser.status.in_([MembershipStatus.ACTIVE, MembershipStatus.TERMINATED]),
        )
        .order_by(Project.id.asc())
        .limit(1)
    )
    return list(db.scalars(stmt).all())


def create_project(db: Session, payload: ProjectCreate, admin_user: User) -> Project:
    project = Project(
        name=payload.name.strip(),
        logo_url=payload.logo_url,
        operator_terminated_message=(payload.operator_terminated_message or "").strip() or None,
        support_email=(str(payload.support_email).strip() if payload.support_email is not None else None) or None,
        support_phone=(payload.support_phone or "").strip() or None,
    )
    db.add(project)
    db.flush()

    upsert_project_membership(
        db,
        project_id=project.id,
        user_id=admin_user.id,
        role_override=UserRole.ADMIN,
        status=MembershipStatus.ACTIVE,
    )
    return project


def update_project(project: Project, payload: ProjectUpdate) -> Project:
    if payload.name is not None:
        project.name = payload.name.strip()
    if payload.logo_url is not None:
        project.logo_url = payload.logo_url
    if payload.operator_terminated_message is not None:
        project.operator_terminated_message = (payload.operator_terminated_message or "").strip() or None
    if payload.support_email is not None:
        project.support_email = str(payload.support_email).strip() or None
    if payload.support_phone is not None:
        project.support_phone = (payload.support_phone or "").strip() or None
    return project
