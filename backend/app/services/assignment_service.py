from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    MemberAssignment,
    MembershipStatus,
    OperatorAssignment,
    ProjectUser,
    User,
    UserRole,
)
from app.services import conversation_service, project_service, user_service


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def admin_assign_operator(db: Session, *, project_id: int, admin: User, operator_id: int) -> None:
    operator = _get_user_or_404(db, operator_id)
    if operator.role != UserRole.OPERATOR:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target user is not an operator")

    project_service.upsert_project_membership(db, project_id=project_id, user_id=admin.id, role_override=UserRole.ADMIN)
    project_service.upsert_project_membership(db, project_id=project_id, user_id=operator.id, role_override=UserRole.OPERATOR)

    assignment = db.scalar(
        select(OperatorAssignment).where(
            OperatorAssignment.project_id == project_id,
            OperatorAssignment.operator_id == operator.id,
        )
    )
    if assignment:
        assignment.admin_id = admin.id
        assignment.is_active = True
    else:
        assignment = OperatorAssignment(project_id=project_id, admin_id=admin.id, operator_id=operator.id, is_active=True)
        db.add(assignment)

    conversation_service.get_or_create_admin_operator_conversation(
        db,
        project_id=project_id,
        admin_id=admin.id,
        operator_id=operator.id,
    )


def admin_remove_operator(db: Session, *, project_id: int, operator_id: int, terminate: bool = False) -> None:
    assignment = db.scalar(
        select(OperatorAssignment).where(
            OperatorAssignment.project_id == project_id,
            OperatorAssignment.operator_id == operator_id,
            OperatorAssignment.is_active.is_(True),
        )
    )
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operator assignment not found")

    assignment.is_active = False
    membership = db.scalar(
        select(ProjectUser).where(ProjectUser.project_id == project_id, ProjectUser.user_id == operator_id)
    )
    if membership:
        membership.status = MembershipStatus.TERMINATED if terminate else MembershipStatus.REMOVED

    from app.models import MemberAssignment

    operator_members = db.scalars(
        select(MemberAssignment).where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.operator_id == operator_id,
            MemberAssignment.is_active.is_(True),
        )
    ).all()
    for item in operator_members:
        item.is_active = False
        # Keep member project membership active so admin can reassign later.
        member_membership = db.scalar(
            select(ProjectUser).where(ProjectUser.project_id == project_id, ProjectUser.user_id == item.member_id)
        )
        if member_membership and member_membership.status != MembershipStatus.ACTIVE:
            member_membership.status = MembershipStatus.ACTIVE


def terminate_user_in_project(db: Session, *, project_id: int, user_id: int) -> None:
    """
    Project-scoped termination without deleting the account.
    - Operator: terminate operator membership/assignment, unassign members (members remain in project for reassignment).
    - Member: terminate member project membership and active assignment.
    """
    target = _get_user_or_404(db, user_id)
    if target.role == UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admin accounts cannot be terminated")

    membership = db.scalar(
        select(ProjectUser).where(ProjectUser.project_id == project_id, ProjectUser.user_id == user_id)
    )
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User is not part of this project")
    membership.status = MembershipStatus.TERMINATED

    if target.role == UserRole.OPERATOR:
        op_assignment = db.scalar(
            select(OperatorAssignment).where(
                OperatorAssignment.project_id == project_id,
                OperatorAssignment.operator_id == user_id,
                OperatorAssignment.is_active.is_(True),
            )
        )
        if op_assignment:
            op_assignment.is_active = False

        operator_members = db.scalars(
            select(MemberAssignment).where(
                MemberAssignment.project_id == project_id,
                MemberAssignment.operator_id == user_id,
                MemberAssignment.is_active.is_(True),
            )
        ).all()
        for item in operator_members:
            item.is_active = False
            member_membership = db.scalar(
                select(ProjectUser).where(ProjectUser.project_id == project_id, ProjectUser.user_id == item.member_id)
            )
            if member_membership and member_membership.status != MembershipStatus.ACTIVE:
                member_membership.status = MembershipStatus.ACTIVE
        return

    if target.role == UserRole.MEMBER:
        member_assignment = db.scalar(
            select(MemberAssignment).where(
                MemberAssignment.project_id == project_id,
                MemberAssignment.member_id == user_id,
                MemberAssignment.is_active.is_(True),
            )
        )
        if member_assignment:
            member_assignment.is_active = False


def operator_create_member(
    db: Session,
    *,
    project_id: int,
    operator: User,
    email: str,
    name: str,
    password_hash: str,
) -> User:
    """Create a new member user and assign to the operator in one step. Returns the created user."""
    if operator.role != UserRole.OPERATOR:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator role required")

    op_assignment = db.scalar(
        select(OperatorAssignment).where(
            OperatorAssignment.project_id == project_id,
            OperatorAssignment.operator_id == operator.id,
            OperatorAssignment.is_active.is_(True),
        )
    )
    if not op_assignment:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator is not assigned to this project")

    normalized_email = user_service.normalize_email(email)
    existing = user_service.get_active_user_by_email(db, normalized_email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")

    from app.core.security import hash_password

    member = User(
        uid=user_service.generate_unique_uid(db),
        email=normalized_email,
        name=name.strip(),
        password_hash=hash_password(password_hash),
        role=UserRole.MEMBER,
        is_active=True,
    )
    db.add(member)
    db.flush()

    project_service.upsert_project_membership(db, project_id=project_id, user_id=member.id, role_override=UserRole.MEMBER)
    project_service.upsert_project_membership(db, project_id=project_id, user_id=operator.id, role_override=UserRole.OPERATOR)

    assignment = MemberAssignment(
        project_id=project_id,
        operator_id=operator.id,
        member_id=member.id,
        is_active=True,
    )
    db.add(assignment)

    conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project_id,
        operator_id=operator.id,
        member_id=member.id,
    )

    return member


def operator_assign_member(db: Session, *, project_id: int, operator: User, member_id: int) -> None:
    if operator.role != UserRole.OPERATOR and operator.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator or Admin role required")

    op_assignment = db.scalar(
        select(OperatorAssignment).where(
            OperatorAssignment.project_id == project_id,
            OperatorAssignment.operator_id == operator.id,
            OperatorAssignment.is_active.is_(True),
        )
    )
    if not op_assignment:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator is not assigned to this project")

    member = _get_user_or_404(db, member_id)
    if member.role != UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target user is not a member")

    project_service.upsert_project_membership(db, project_id=project_id, user_id=member.id, role_override=UserRole.MEMBER)
    project_service.upsert_project_membership(db, project_id=project_id, user_id=operator.id, role_override=UserRole.OPERATOR)

    from app.models import MemberAssignment

    assignment = db.scalar(
        select(MemberAssignment).where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.member_id == member.id,
        )
    )
    if assignment:
        assignment.operator_id = operator.id
        assignment.is_active = True
    else:
        assignment = MemberAssignment(project_id=project_id, operator_id=operator.id, member_id=member.id, is_active=True)
        db.add(assignment)

    conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project_id,
        operator_id=operator.id,
        member_id=member.id,
    )


def operator_remove_member(db: Session, *, project_id: int, operator: User, member_id: int, terminate: bool = False) -> None:
    if operator.role != UserRole.OPERATOR and operator.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator or Admin role required")

    from app.models import MemberAssignment

    assignment = db.scalar(
        select(MemberAssignment).where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.operator_id == operator.id,
            MemberAssignment.member_id == member_id,
            MemberAssignment.is_active.is_(True),
        )
    )
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member assignment not found")

    assignment.is_active = False

    membership = db.scalar(
        select(ProjectUser).where(ProjectUser.project_id == project_id, ProjectUser.user_id == member_id)
    )
    if membership:
        membership.status = MembershipStatus.TERMINATED if terminate else MembershipStatus.REMOVED


def admin_remove_member_from_project(
    db: Session,
    *,
    project_id: int,
    admin: User,
    member_id: int,
    terminate: bool = False,
) -> None:
    """Admin: remove a member from their operator assignment in this project (any operator)."""
    if admin.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    member = _get_user_or_404(db, member_id)
    if member.role != UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target user is not a member")

    assignment = db.scalar(
        select(MemberAssignment).where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.member_id == member_id,
            MemberAssignment.is_active.is_(True),
        )
    )
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Member assignment not found")

    assignment.is_active = False

    membership = db.scalar(
        select(ProjectUser).where(ProjectUser.project_id == project_id, ProjectUser.user_id == member_id)
    )
    if membership:
        membership.status = MembershipStatus.TERMINATED if terminate else MembershipStatus.REMOVED


def admin_assign_member_to_operator(
    db: Session,
    *,
    project_id: int,
    admin: User,
    member_id: int,
    operator_id: int,
) -> None:
    """Admin-only: (re)assign an existing member to a specific operator within a project."""
    if admin.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    operator = _get_user_or_404(db, operator_id)
    if operator.role != UserRole.OPERATOR or not operator.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target user is not an active operator")

    member = _get_user_or_404(db, member_id)
    if member.role != UserRole.MEMBER or not member.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target user is not an active member")

    op_assignment = db.scalar(
        select(OperatorAssignment).where(
            OperatorAssignment.project_id == project_id,
            OperatorAssignment.operator_id == operator.id,
            OperatorAssignment.is_active.is_(True),
        )
    )
    if not op_assignment:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator is not assigned to this project")

    project_service.upsert_project_membership(db, project_id=project_id, user_id=member.id, role_override=UserRole.MEMBER)
    project_service.upsert_project_membership(db, project_id=project_id, user_id=operator.id, role_override=UserRole.OPERATOR)
    project_service.upsert_project_membership(db, project_id=project_id, user_id=admin.id, role_override=UserRole.ADMIN)

    assignment = db.scalar(
        select(MemberAssignment).where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.member_id == member.id,
        )
    )
    if assignment:
        assignment.operator_id = operator.id
        assignment.is_active = True
    else:
        db.add(
            MemberAssignment(
                project_id=project_id,
                operator_id=operator.id,
                member_id=member.id,
                is_active=True,
            )
        )

    conversation_service.get_or_create_operator_member_conversation(
        db,
        project_id=project_id,
        operator_id=operator.id,
        member_id=member.id,
    )


def deactivate_user_globally(db: Session, *, user_id: int) -> None:
    """Completely deactivate a user across all projects."""
    target = _get_user_or_404(db, user_id)
    if target.role == UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admins cannot be deactivated via this endpoint")

    target.is_active = False

    from app.models import MemberAssignment

    for oa in db.scalars(select(OperatorAssignment).where(OperatorAssignment.operator_id == user_id, OperatorAssignment.is_active.is_(True))).all():
        oa.is_active = False
    for ma in db.scalars(select(MemberAssignment).where(MemberAssignment.operator_id == user_id, MemberAssignment.is_active.is_(True))).all():
        ma.is_active = False
    for ma in db.scalars(select(MemberAssignment).where(MemberAssignment.member_id == user_id, MemberAssignment.is_active.is_(True))).all():
        ma.is_active = False
    for pu in db.scalars(select(ProjectUser).where(ProjectUser.user_id == user_id, ProjectUser.status == MembershipStatus.ACTIVE)).all():
        pu.status = MembershipStatus.REMOVED


def list_project_operators(db: Session, *, project_id: int) -> list[User]:
    stmt = (
        select(User)
        .join(OperatorAssignment, OperatorAssignment.operator_id == User.id)
        .where(
            OperatorAssignment.project_id == project_id,
            OperatorAssignment.is_active.is_(True),
            User.is_active.is_(True),
        )
        .order_by(User.id.asc())
    )
    return list(db.scalars(stmt).all())


def list_project_operators_with_status(db: Session, *, project_id: int) -> list[dict]:
    rows = db.execute(
        select(
            User.id,
            User.uid,
            User.email,
            User.name,
            User.role,
            User.is_active,
            User.created_at,
            ProjectUser.status.label("membership_status"),
            OperatorAssignment.is_active.label("is_assigned"),
        )
        .join(ProjectUser, ProjectUser.user_id == User.id)
        .outerjoin(
            OperatorAssignment,
            (OperatorAssignment.operator_id == User.id) & (OperatorAssignment.project_id == project_id),
        )
        .where(
            ProjectUser.project_id == project_id,
            ProjectUser.role_override == UserRole.OPERATOR,
            ProjectUser.status.in_([MembershipStatus.ACTIVE, MembershipStatus.REMOVED, MembershipStatus.TERMINATED]),
        )
        .order_by(User.id.asc())
    ).all()
    result: list[dict] = []
    for r in rows:
        result.append(
            {
                "id": r.id,
                "uid": r.uid,
                "email": r.email,
                "name": r.name,
                "role": r.role,
                "is_active": r.is_active,
                "created_at": r.created_at,
                "membership_status": str(r.membership_status.value if hasattr(r.membership_status, "value") else r.membership_status),
                "is_assigned": bool(r.is_assigned),
            }
        )
    return result


def list_operators_assignable_to_project(db: Session, *, project_id: int) -> list[User]:
    """
    Active operators not currently assigned to this project (includes operators
    previously removed from this project — they can be re-assigned from this list).
    """
    assigned_subq = select(OperatorAssignment.operator_id).where(
        OperatorAssignment.project_id == project_id,
        OperatorAssignment.is_active.is_(True),
    )
    stmt = (
        select(User)
        .where(
            User.role == UserRole.OPERATOR,
            User.is_active.is_(True),
            User.id.not_in(assigned_subq),
        )
        .order_by(User.id.asc())
    )
    return list(db.scalars(stmt).all())


def permanently_delete_user_account(db: Session, *, user_id: int) -> None:
    """Delete the user row (DB CASCADE cleans assignments, messages, etc.). Admins cannot be deleted."""
    target = _get_user_or_404(db, user_id)
    if target.role == UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin accounts cannot be permanently deleted",
        )
    db.delete(target)


def list_member_operators(db: Session, *, project_id: int, member_id: int) -> list[User]:
    """Return operators that the member is actively assigned to in this project."""
    stmt = (
        select(User)
        .join(MemberAssignment, MemberAssignment.operator_id == User.id)
        .where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.member_id == member_id,
            MemberAssignment.is_active.is_(True),
            User.is_active.is_(True),
        )
        .order_by(User.id.asc())
    )
    return list(db.scalars(stmt).all())


def list_project_members(
    db: Session, *, project_id: int, viewer: User, for_assign: bool = False
) -> list[User]:
    """List project members. Admin sees all active project members, operator sees only active assigned members."""
    from app.models import MemberAssignment

    if viewer.role == UserRole.ADMIN:
        stmt = (
            select(User)
            .join(ProjectUser, ProjectUser.user_id == User.id)
            .where(
                ProjectUser.project_id == project_id,
                ProjectUser.status.in_([MembershipStatus.ACTIVE, MembershipStatus.REMOVED, MembershipStatus.TERMINATED]),
                User.role == UserRole.MEMBER,
                User.is_active.is_(True),
            )
            .order_by(User.id.asc())
        )
        return list(db.scalars(stmt).all())

    stmt = (
        select(User)
        .join(MemberAssignment, MemberAssignment.member_id == User.id)
        .where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.is_active.is_(True),
            User.is_active.is_(True),
        )
    )
    if viewer.role == UserRole.OPERATOR:
        stmt = stmt.where(MemberAssignment.operator_id == viewer.id)
    if viewer.role == UserRole.MEMBER:
        stmt = stmt.where(User.id == viewer.id)
    return list(db.scalars(stmt.order_by(User.id.asc())).all())


def list_users_by_role(db: Session, *, role: UserRole) -> list[User]:
    stmt = select(User).where(User.role == role, User.is_active.is_(True)).order_by(User.id.asc())
    return list(db.scalars(stmt).all())


def list_project_refresh_target_user_ids(
    db: Session,
    *,
    project_id: int,
    extra_user_ids: list[int] | None = None,
) -> set[int]:
    """Users who should refresh local project state after assignment/user changes."""
    project_user_ids = set(
        db.scalars(
            select(ProjectUser.user_id).where(ProjectUser.project_id == project_id)
        ).all()
    )
    project_user_ids.update(
        db.scalars(
            select(User.id).where(
                User.role == UserRole.ADMIN,
                User.is_active.is_(True),
            )
        ).all()
    )
    if extra_user_ids:
        project_user_ids.update(extra_user_ids)
    return project_user_ids


def list_user_project_ids(db: Session, *, user_id: int) -> list[int]:
    """All project ids the user has ever been attached to via membership rows."""
    return list(
        dict.fromkeys(
            db.scalars(
                select(ProjectUser.project_id).where(ProjectUser.user_id == user_id)
            ).all()
        )
    )


def list_project_members_with_operators(db: Session, *, project_id: int) -> list[dict]:
    """
    Admin-only: return all members in a project along with their assigned operator.
    Returns a list of dicts with member fields + assigned_operator_* fields.
    """
    rows = db.execute(
        select(
            User.id,
            User.uid,
            User.email,
            User.name,
            User.role,
            User.is_active,
            User.created_at,
            MemberAssignment.operator_id.label("assigned_operator_id"),
            ProjectUser.status.label("membership_status"),
        )
        .join(ProjectUser, ProjectUser.user_id == User.id)
        .outerjoin(
            MemberAssignment,
            (MemberAssignment.member_id == User.id)
            & (MemberAssignment.project_id == project_id)
            & (MemberAssignment.is_active.is_(True)),
        )
        .where(
            ProjectUser.project_id == project_id,
            ProjectUser.status.in_([MembershipStatus.ACTIVE, MembershipStatus.REMOVED, MembershipStatus.TERMINATED]),
            User.role == UserRole.MEMBER,
        )
        .order_by(User.id.asc())
    ).all()

    operator_ids = list({r.assigned_operator_id for r in rows if r.assigned_operator_id})
    operators_map: dict[int, User] = {}
    if operator_ids:
        ops = db.scalars(select(User).where(User.id.in_(operator_ids))).all()
        for op in ops:
            operators_map[op.id] = op

    result: list[dict] = []
    for r in rows:
        op = operators_map.get(r.assigned_operator_id) if r.assigned_operator_id else None
        result.append(
            {
                "id": r.id,
                "uid": r.uid,
                "email": r.email,
                "name": r.name,
                "role": r.role,
                "is_active": r.is_active,
                "created_at": r.created_at,
                "assigned_operator_id": r.assigned_operator_id,
                "assigned_operator_name": op.name if op else None,
                "assigned_operator_uid": op.uid if op else None,
                "membership_status": str(r.membership_status.value if hasattr(r.membership_status, "value") else r.membership_status),
            }
        )
    return result
