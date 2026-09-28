from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.realtime import (
    broadcast_conversation_upserts,
    broadcast_members_changed_sync,
    broadcast_notification_counts,
    broadcast_operators_changed_sync,
)
from app.core.deps import ensure_project_access, get_current_user, require_admin, require_super_admin
from app.core.config import settings
from app.core.websocket_manager import manager
from app.core.security import hash_password
from app.db.session import get_db
from app.models import ConversationType, User, UserRole
from app.schemas import (
    AdminMemberCreate,
    AssignmentResponse,
    BulkDeactivateUsersRequest,
    BroadcastRequest,
    BroadcastResponse,
    BulkConversationClearRequest,
    MemberReassignRequest,
    MessageOut,
    PasswordChangeRequest,
    UserCreate,
    UserOut,
)
from app.services import assignment_service, conversation_service, notification_service, user_service

router = APIRouter(tags=["admin"])


def _project_targets(db: Session, *, project_id: int, extra_user_ids: list[int] | None = None) -> set[int]:
    return assignment_service.list_project_refresh_target_user_ids(
        db,
        project_id=project_id,
        extra_user_ids=extra_user_ids,
    )


def _broadcast_member_change(db: Session, *, project_id: int, reason: str, extra_user_ids: list[int] | None = None) -> None:
    targets = _project_targets(db, project_id=project_id, extra_user_ids=extra_user_ids)
    broadcast_members_changed_sync(project_id=project_id, user_ids=targets, reason=reason)


def _broadcast_operator_change(db: Session, *, project_id: int, reason: str, extra_user_ids: list[int] | None = None) -> None:
    targets = _project_targets(db, project_id=project_id, extra_user_ids=extra_user_ids)
    broadcast_operators_changed_sync(project_id=project_id, user_ids=targets, reason=reason)


@router.post("/admin/users", response_model=UserOut)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserOut:
    require_admin(current_user)
    if payload.role == UserRole.MEMBER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Members must be created inside a project. Use the Admin Members panel (Create Member).",
        )
    if payload.role == UserRole.ADMIN:
        # Only the super admin may create another Admin account. This is enforced here
        # regardless of what the frontend sends or hides in its UI.
        require_super_admin(current_user)

    normalized_email = user_service.normalize_email(payload.email)
    existing = user_service.get_active_user_by_email(db, normalized_email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")

    user = User(
        uid=user_service.generate_unique_uid(db),
        email=normalized_email,
        name=payload.name.strip(),
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserOut.model_validate(user)


@router.post("/projects/{project_id}/admin/members", response_model=UserOut)
def admin_create_member(
    project_id: int,
    payload: AdminMemberCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserOut:
    """
    Admin creates a member inside a specific project and assigns them to the selected operator.
    """
    ensure_project_access(db, current_user, project_id)
    require_admin(current_user)

    operator = db.scalar(
        select(User).where(
            User.id == payload.operator_id,
            User.role == UserRole.OPERATOR,
            User.is_active.is_(True),
        )
    )
    if not operator:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operator not found")

    member = assignment_service.operator_create_member(
        db,
        project_id=project_id,
        operator=operator,
        email=payload.email,
        name=payload.name,
        password_hash=payload.password,  # assignment_service will hash it
    )
    db.commit()
    db.refresh(member)
    _broadcast_member_change(db, project_id=project_id, reason="member_created", extra_user_ids=[member.id])
    return UserOut.model_validate(member)


@router.post("/projects/{project_id}/members/{member_id}/assign-operator", response_model=AssignmentResponse)
def admin_assign_member_operator(
    project_id: int,
    member_id: int,
    payload: MemberReassignRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    """Admin-only: reassign an existing member to a different operator in this project."""
    ensure_project_access(db, current_user, project_id)
    require_admin(current_user)
    assignment_service.admin_assign_member_to_operator(
        db,
        project_id=project_id,
        admin=current_user,
        member_id=member_id,
        operator_id=payload.operator_id,
    )
    db.commit()
    _broadcast_member_change(db, project_id=project_id, reason="member_reassigned", extra_user_ids=[member_id])
    return AssignmentResponse(detail="Member assigned successfully")


@router.patch("/admin/users/{user_id}/password")
def change_user_password(
    user_id: int,
    payload: PasswordChangeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    """Admin resets/changes password for operators and members."""
    require_admin(current_user)

    target = db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.role == UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change another admin's password")

    target.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"detail": "Password updated successfully"}


@router.patch("/admin/admins/{user_id}/password")
def reset_admin_password(
    user_id: int,
    payload: PasswordChangeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    require_admin(current_user)
    if current_user.email.lower() != settings.super_admin_email.lower():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin privileges required")

    target = db.scalar(select(User).where(User.id == user_id, User.is_active.is_(True)))
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target user is not an admin")

    target.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"detail": "Admin password updated successfully"}


@router.post("/projects/{project_id}/operators/{operator_id}/assign", response_model=AssignmentResponse)
def assign_operator(
    project_id: int,
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    ensure_project_access(db, current_user, project_id)
    require_admin(current_user)
    assignment_service.admin_assign_operator(db, project_id=project_id, admin=current_user, operator_id=operator_id)
    db.commit()
    _broadcast_operator_change(db, project_id=project_id, reason="operator_assigned", extra_user_ids=[operator_id])
    return AssignmentResponse(detail="Operator assigned successfully")


@router.delete("/projects/{project_id}/operators/{operator_id}/remove", response_model=AssignmentResponse)
def remove_operator(
    project_id: int,
    operator_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    ensure_project_access(db, current_user, project_id)
    require_admin(current_user)
    assignment_service.admin_remove_operator(db, project_id=project_id, operator_id=operator_id)
    db.commit()
    _broadcast_operator_change(db, project_id=project_id, reason="operator_removed", extra_user_ids=[operator_id])
    return AssignmentResponse(detail="Operator removed successfully")


@router.delete("/projects/{project_id}/users/{user_id}/terminate", response_model=AssignmentResponse)
def terminate_user_from_project(
    project_id: int,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    """Terminate user only in this project; account is kept for future reassignment/reactivation."""
    ensure_project_access(db, current_user, project_id)
    require_admin(current_user)
    assignment_service.terminate_user_in_project(db, project_id=project_id, user_id=user_id)
    db.commit()
    target = db.scalar(select(User).where(User.id == user_id))
    if target and target.role == UserRole.OPERATOR:
        _broadcast_operator_change(db, project_id=project_id, reason="user_terminated", extra_user_ids=[user_id])
    else:
        _broadcast_member_change(db, project_id=project_id, reason="user_terminated", extra_user_ids=[user_id])
    return AssignmentResponse(detail="User terminated from this project")


@router.delete("/admin/users/{user_id}/deactivate", response_model=AssignmentResponse)
def deactivate_user_globally(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    require_admin(current_user)
    target = db.scalar(select(User).where(User.id == user_id))
    target_role = target.role if target else None
    project_ids = assignment_service.list_user_project_ids(db, user_id=user_id)
    assignment_service.deactivate_user_globally(db, user_id=user_id)
    db.commit()
    for project_id in project_ids:
        if target_role == UserRole.OPERATOR:
            _broadcast_operator_change(db, project_id=project_id, reason="user_deactivated_globally", extra_user_ids=[user_id])
        else:
            _broadcast_member_change(db, project_id=project_id, reason="user_deactivated_globally", extra_user_ids=[user_id])
    return AssignmentResponse(detail="User deactivated globally")


@router.delete("/admin/users/{user_id}/permanent", response_model=AssignmentResponse)
def permanently_delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    require_admin(current_user)
    target = db.scalar(select(User).where(User.id == user_id))
    target_role = target.role if target else None
    project_ids = assignment_service.list_user_project_ids(db, user_id=user_id)
    assignment_service.permanently_delete_user_account(db, user_id=user_id)
    db.commit()
    for project_id in project_ids:
        if target_role == UserRole.OPERATOR:
            _broadcast_operator_change(db, project_id=project_id, reason="user_permanently_deleted", extra_user_ids=[user_id])
        else:
            _broadcast_member_change(db, project_id=project_id, reason="user_permanently_deleted", extra_user_ids=[user_id])
    return AssignmentResponse(detail="User permanently deleted")


@router.post("/admin/users/deactivate/bulk", response_model=AssignmentResponse)
def deactivate_users_globally_bulk(
    payload: BulkDeactivateUsersRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    require_admin(current_user)
    project_ids_by_user: dict[int, list[int]] = {}
    role_by_user: dict[int, UserRole] = {}
    for uid in payload.user_ids:
        target = db.scalar(select(User).where(User.id == uid))
        if not target:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"User {uid} not found")
        if target.role == UserRole.ADMIN:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admin accounts cannot be deactivated")
        role_by_user[uid] = target.role
        project_ids_by_user[uid] = assignment_service.list_user_project_ids(db, user_id=uid)
        assignment_service.deactivate_user_globally(db, user_id=uid)
    db.commit()
    refresh_targets_by_project: dict[int, set[int]] = {}
    for uid, project_ids in project_ids_by_user.items():
        for project_id in project_ids:
            refresh_targets_by_project.setdefault(project_id, set()).add(uid)
    for project_id, extra_user_ids in refresh_targets_by_project.items():
        if any(role_by_user.get(uid) == UserRole.OPERATOR for uid in extra_user_ids):
            _broadcast_operator_change(
                db,
                project_id=project_id,
                reason="users_deactivated_globally",
                extra_user_ids=list(extra_user_ids),
            )
        if any(role_by_user.get(uid) != UserRole.OPERATOR for uid in extra_user_ids):
            _broadcast_member_change(
                db,
                project_id=project_id,
                reason="users_deactivated_globally",
                extra_user_ids=list(extra_user_ids),
            )
    return AssignmentResponse(detail="Selected users deactivated globally")


@router.post("/admin/users/permanent-delete/bulk", response_model=AssignmentResponse)
def permanently_delete_users_bulk(
    payload: BulkDeactivateUsersRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    require_admin(current_user)
    seen: set[int] = set()
    target_ids: list[int] = []
    project_ids_by_user: dict[int, list[int]] = {}
    role_by_user: dict[int, UserRole] = {}
    for uid in payload.user_ids:
        if uid in seen:
            continue
        seen.add(uid)
        target = db.scalar(select(User).where(User.id == uid))
        if not target:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"User {uid} not found")
        if target.role == UserRole.ADMIN:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admin accounts cannot be permanently deleted")
        target_ids.append(uid)
        role_by_user[uid] = target.role
        project_ids_by_user[uid] = assignment_service.list_user_project_ids(db, user_id=uid)

    for uid in target_ids:
        assignment_service.permanently_delete_user_account(db, user_id=uid)
    db.commit()
    refresh_targets_by_project: dict[int, set[int]] = {}
    for uid, project_ids in project_ids_by_user.items():
        for project_id in project_ids:
            refresh_targets_by_project.setdefault(project_id, set()).add(uid)
    for project_id, extra_user_ids in refresh_targets_by_project.items():
        if any(role_by_user.get(uid) == UserRole.OPERATOR for uid in extra_user_ids):
            _broadcast_operator_change(
                db,
                project_id=project_id,
                reason="users_permanently_deleted",
                extra_user_ids=list(extra_user_ids),
            )
        if any(role_by_user.get(uid) != UserRole.OPERATOR for uid in extra_user_ids):
            _broadcast_member_change(
                db,
                project_id=project_id,
                reason="users_permanently_deleted",
                extra_user_ids=list(extra_user_ids),
            )
    return AssignmentResponse(detail="Selected users permanently deleted")


@router.delete("/projects/{project_id}/conversations/{conversation_id}", response_model=AssignmentResponse)
async def delete_conversation(
    project_id: int,
    conversation_id: int,
    scope: str = Query(default="all", pattern="^(me|all)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    ensure_project_access(db, current_user, project_id)
    require_admin(current_user)
    conversation = conversation_service.delete_conversation(
        db,
        project_id=project_id,
        conversation_id=conversation_id,
        admin=current_user,
        scope=scope,
    )
    db.commit()

    targets = conversation_service.get_clear_event_targets(
        db,
        project_id=project_id,
        conversation=conversation,
        scope=scope,
        requester_admin_id=current_user.id,
    )
    await manager.broadcast_to_users(
        project_id,
        list(targets),
        {
            "event": "conversation:cleared",
            "data": {"conversation_id": conversation.id, "scope": scope},
        },
    )

    if scope == "me":
        return AssignmentResponse(detail="Chat history cleared for you")
    return AssignmentResponse(detail="Chat history cleared for all participants")


@router.post("/projects/{project_id}/conversations/clear/bulk", response_model=AssignmentResponse)
async def clear_conversations_bulk(
    project_id: int,
    payload: BulkConversationClearRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    ensure_project_access(db, current_user, project_id)
    require_admin(current_user)
    conversations = conversation_service.delete_conversations_bulk(
        db,
        project_id=project_id,
        conversation_ids=payload.conversation_ids,
        admin=current_user,
    )
    db.commit()

    for conversation in conversations:
        targets = conversation_service.get_clear_event_targets(
            db,
            project_id=project_id,
            conversation=conversation,
            scope="all",
            requester_admin_id=current_user.id,
        )
        await manager.broadcast_to_users(
            project_id,
            list(targets),
            {
                "event": "conversation:cleared",
                "data": {"conversation_id": conversation.id, "scope": "all"},
            },
        )

    return AssignmentResponse(detail="Selected chats cleared for all participants")


@router.post("/projects/{project_id}/conversations/hide/bulk", response_model=AssignmentResponse)
async def hide_conversations_bulk(
    project_id: int,
    payload: BulkConversationClearRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentResponse:
    ensure_project_access(db, current_user, project_id)
    require_admin(current_user)
    hidden = conversation_service.hide_conversations_for_admin_bulk(
        db,
        project_id=project_id,
        conversation_ids=payload.conversation_ids,
        admin=current_user,
    )
    db.commit()

    return AssignmentResponse(detail=f"Hidden {len(hidden)} conversation(s) from admin inbox")


@router.post("/projects/{project_id}/members/broadcast", response_model=BroadcastResponse)
async def broadcast_message(
    project_id: int,
    payload: BroadcastRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BroadcastResponse:
    ensure_project_access(db, current_user, project_id)
    require_admin(current_user)
    if payload.delivery_method == "chat":
        messages = conversation_service.broadcast_admin_message(
            db,
            project_id=project_id,
            admin=current_user,
            target_member_ids=payload.member_ids,
            all_members=payload.all_members,
            target_operator_ids=payload.operator_ids,
            all_operators=payload.all_operators,
            content=payload.content,
        )
        notification_targets: set[int] = set()
        conversation_targets: dict[int, set[int]] = {}
        pending_messages: list[tuple] = []
        for msg in messages:
            recipients = conversation_service.get_message_recipients(
                db, project_id=project_id, conversation_id=msg.conversation_id,
            )
            conversation_targets.setdefault(msg.conversation_id, set()).update(recipients)
            ann_title = f"Announcement from {current_user.name}: {payload.content}"
            for uid in recipients:
                if uid == current_user.id:
                    continue
                rcpt = db.get(User, uid)
                if rcpt and rcpt.role == UserRole.ADMIN:
                    continue
                notification_targets.add(uid)
                notification_service.create_notification(
                    db,
                    project_id=project_id,
                    user_id=uid,
                    kind="admin_broadcast",
                    title=ann_title,
                    reference_id=msg.conversation_id,
                )
            pending_messages.append((msg, recipients))
        db.commit()
        for msg, recipients in pending_messages:
            db.refresh(msg)
            payload_data = MessageOut.model_validate(msg).model_dump(mode="json")
            await manager.broadcast_to_users(
                project_id, list(recipients), {"event": "message:new", "data": payload_data}
            )
        for conversation_id, recipients in conversation_targets.items():
            await broadcast_conversation_upserts(
                db,
                project_id=project_id,
                user_ids=recipients,
                conversation_ids={conversation_id},
            )
        if notification_targets:
            await broadcast_notification_counts(db, project_id=project_id, user_ids=notification_targets)
        return BroadcastResponse(detail="Broadcast queued", messages_created=len(messages))
    else:
        # notification only
        targets = conversation_service.resolve_broadcast_targets(
            db,
            project_id=project_id,
            target_member_ids=payload.member_ids,
            all_members=payload.all_members,
            target_operator_ids=payload.operator_ids,
            all_operators=payload.all_operators,
        )
        ann_title = f"Announcement from {current_user.name}: {payload.content}"
        for uid in targets:
            if uid == current_user.id:
                continue
            rcpt = db.get(User, uid)
            if rcpt and rcpt.role == UserRole.ADMIN:
                continue
            notification_service.create_notification(
                db,
                project_id=project_id,
                user_id=uid,
                kind="admin_broadcast",
                title=ann_title,
                reference_id=None,
            )
        db.commit()
        non_admin_targets: set[int] = set()
        for uid in targets:
            if uid == current_user.id:
                continue
            rcpt = db.get(User, uid)
            if rcpt and rcpt.role == UserRole.ADMIN:
                continue
            non_admin_targets.add(uid)
        if non_admin_targets:
            await broadcast_notification_counts(db, project_id=project_id, user_ids=non_admin_targets)
        return BroadcastResponse(detail="Notification broadcast sent", messages_created=0)
