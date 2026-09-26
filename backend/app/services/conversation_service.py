from datetime import datetime, timedelta, timezone
import logging

from fastapi import HTTPException, status
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Conversation,
    ConversationHidden,
    ConversationParticipant,
    ConversationType,
    MemberAssignment,
    MembershipStatus,
    Message,
    MessageRead,
    MessageType,
    Notification,
    OperatorAssignment,
    ProjectUser,
    User,
    UserRole,
)
from app.schemas import ConversationOut

logger = logging.getLogger(__name__)

def _normalize_user_role(value: object) -> str:
    """Normalize enum/string role payloads into ADMIN/OPERATOR/MEMBER."""
    if value is None:
        return ""
    raw = value.value if hasattr(value, "value") else str(value)
    cleaned = raw.strip().upper()
    if "." in cleaned:
        cleaned = cleaned.split(".")[-1]
    return cleaned


def _coerce_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)

def _list_active_project_admin_ids(db: Session, *, project_id: int) -> list[int]:
    # Admin inbox work is shared across the product: any active admin can open
    # and work a project's admin/operator threads, even if they were not the
    # admin who originally assigned the operator.
    return list(
        db.scalars(
            select(User.id).where(
                User.role == UserRole.ADMIN,
                User.is_active.is_(True),
            )
        ).all()
    )


def _is_active_project_admin(db: Session, *, project_id: int, user_id: int) -> bool:
    return db.scalar(
        select(User.id).where(
            User.id == user_id,
            User.role == UserRole.ADMIN,
            User.is_active.is_(True),
        )
    ) is not None


def select_active_users_by_ids(user_ids: list[int]):
    return select(User).where(User.id.in_(user_ids), User.is_active.is_(True))


def _get_canonical_admin_operator_conversation(
    db: Session,
    *,
    project_id: int,
    operator_id: int,
) -> Conversation | None:
    conv = db.scalar(
        select(Conversation).where(
            Conversation.project_id == project_id,
            Conversation.type == ConversationType.ADMIN_OPERATOR,
            Conversation.operator_id == operator_id,
        ).order_by(Conversation.id.asc())
    )
    return conv


def get_or_create_admin_operator_conversation(db: Session, *, project_id: int, admin_id: int, operator_id: int) -> Conversation:
    conv = _get_canonical_admin_operator_conversation(
        db,
        project_id=project_id,
        operator_id=operator_id,
    )
    if conv:
        return conv

    conv = Conversation(
        project_id=project_id,
        type=ConversationType.ADMIN_OPERATOR,
        admin_id=admin_id,
        operator_id=operator_id,
        member_id=None,
        name="",
    )
    db.add(conv)
    db.flush()
    return conv


def get_or_create_operator_member_conversation(db: Session, *, project_id: int, operator_id: int, member_id: int) -> Conversation:
    conv = db.scalar(
        select(Conversation).where(
            Conversation.project_id == project_id,
            Conversation.type == ConversationType.OPERATOR_MEMBER,
            Conversation.operator_id == operator_id,
            Conversation.member_id == member_id,
        )
    )
    if conv:
        return conv

    conv = Conversation(
        project_id=project_id,
        type=ConversationType.OPERATOR_MEMBER,
        operator_id=operator_id,
        member_id=member_id,
        admin_id=None,
        name="",
    )
    db.add(conv)
    db.flush()
    return conv


def repair_active_assignment_conversations(db: Session, *, project_id: int | None = None) -> int:
    created = 0

    admin_ids = _list_active_project_admin_ids(db, project_id=project_id or 0)
    default_admin_id = admin_ids[0] if admin_ids else None

    operator_stmt = select(OperatorAssignment).where(OperatorAssignment.is_active.is_(True))
    member_stmt = select(MemberAssignment).where(MemberAssignment.is_active.is_(True))
    if project_id is not None:
        operator_stmt = operator_stmt.where(OperatorAssignment.project_id == project_id)
        member_stmt = member_stmt.where(MemberAssignment.project_id == project_id)

    for assignment in db.scalars(operator_stmt).all():
        admin_id = assignment.admin_id
        if admin_id is None or not _is_active_project_admin(
            db,
            project_id=assignment.project_id,
            user_id=admin_id,
        ):
            admin_id = default_admin_id
        if admin_id is None:
            continue
        if _get_canonical_admin_operator_conversation(
            db,
            project_id=assignment.project_id,
            operator_id=assignment.operator_id,
        ) is None:
            get_or_create_admin_operator_conversation(
                db,
                project_id=assignment.project_id,
                admin_id=admin_id,
                operator_id=assignment.operator_id,
            )
            created += 1

    for assignment in db.scalars(member_stmt).all():
        existing = db.scalar(
            select(Conversation.id).where(
                Conversation.project_id == assignment.project_id,
                Conversation.type == ConversationType.OPERATOR_MEMBER,
                Conversation.operator_id == assignment.operator_id,
                Conversation.member_id == assignment.member_id,
            )
        )
        if existing is not None:
            continue
        get_or_create_operator_member_conversation(
            db,
            project_id=assignment.project_id,
            operator_id=assignment.operator_id,
            member_id=assignment.member_id,
        )
        created += 1

    if created:
        db.flush()
    return created


def _conversation_visible_to_user(
    db: Session,
    *,
    project_id: int,
    conversation: Conversation,
    user: User,
) -> bool:
    if conversation.project_id != project_id:
        return False

    if user.role == UserRole.ADMIN:
        return True

    if user.role == UserRole.OPERATOR:
        if conversation.operator_id != user.id:
            return False
        if conversation.type == ConversationType.ADMIN_OPERATOR:
            return True
        if not _has_active_operator_assignment(db, project_id=project_id, operator_id=user.id):
            return False
        if conversation.member_id is None:
            return False
        if not _has_active_member_assignment(
            db,
            project_id=project_id,
            operator_id=user.id,
            member_id=conversation.member_id,
        ):
            return False
        message_exists = db.scalar(
            select(Message.id).where(
                Message.project_id == project_id,
                Message.conversation_id == conversation.id,
            ).limit(1)
        )
        return message_exists is not None

    if user.role == UserRole.MEMBER:
        if conversation.type != ConversationType.OPERATOR_MEMBER or conversation.member_id != user.id:
            return False
        return _has_active_member_assignment(
            db,
            project_id=project_id,
            operator_id=conversation.operator_id,
            member_id=user.id,
        )

    return False


def serialize_conversation_for_user(
    db: Session,
    *,
    project_id: int,
    user: User,
    conversation_id: int,
) -> ConversationOut | None:
    conversation = db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.project_id == project_id,
        )
    )
    if conversation is None:
        return None
    if not _conversation_visible_to_user(db, project_id=project_id, conversation=conversation, user=user):
        return None

    stats = get_conversation_stats(
        db,
        project_id=project_id,
        user_id=user.id,
        conversations=[conversation],
    ).get(conversation.id, {})
    data = ConversationOut.model_validate(conversation).model_dump()
    data["unread_count"] = int(stats.get("unread_count", 0) or 0)
    data["last_message_at"] = stats.get("last_message_at")
    return ConversationOut(**data)


def _filter_canonical_admin_operator_conversations(
    db: Session,
    *,
    project_id: int,
    conversations: list[Conversation],
) -> list[Conversation]:
    operator_ids = {conversation.operator_id for conversation in conversations if conversation.type == ConversationType.ADMIN_OPERATOR}
    if not operator_ids:
        return conversations

    canonical_rows = db.execute(
        select(
            Conversation.operator_id,
            func.min(Conversation.id).label("canonical_id"),
        )
        .where(
            Conversation.project_id == project_id,
            Conversation.type == ConversationType.ADMIN_OPERATOR,
            Conversation.operator_id.in_(operator_ids),
        )
        .group_by(Conversation.operator_id)
    ).all()
    canonical_by_operator: dict[int, int] = {
        int(operator_id): int(canonical_id)
        for operator_id, canonical_id in canonical_rows
    }

    filtered: list[Conversation] = []
    for conversation in conversations:
        if conversation.type != ConversationType.ADMIN_OPERATOR:
            filtered.append(conversation)
            continue
        if canonical_by_operator.get(conversation.operator_id) == conversation.id:
            filtered.append(conversation)
    return filtered


def merge_duplicate_admin_operator_conversations(db: Session, *, project_id: int | None = None) -> int:
    """Merge duplicate admin<->operator conversations into one canonical thread per operator."""
    duplicate_groups_stmt = (
        select(
            Conversation.project_id,
            Conversation.operator_id,
            func.min(Conversation.id).label("canonical_id"),
            func.count(Conversation.id).label("count_rows"),
        )
        .where(Conversation.type == ConversationType.ADMIN_OPERATOR)
        .group_by(Conversation.project_id, Conversation.operator_id)
        .having(func.count(Conversation.id) > 1)
    )
    if project_id is not None:
        duplicate_groups_stmt = duplicate_groups_stmt.where(Conversation.project_id == project_id)

    duplicate_groups = db.execute(duplicate_groups_stmt).all()
    merged_count = 0

    for group_project_id, operator_id, canonical_id, _ in duplicate_groups:
        duplicate_ids = list(
            db.scalars(
                select(Conversation.id).where(
                    Conversation.project_id == group_project_id,
                    Conversation.type == ConversationType.ADMIN_OPERATOR,
                    Conversation.operator_id == operator_id,
                    Conversation.id != canonical_id,
                )
            ).all()
        )
        if not duplicate_ids:
            continue

        for duplicate_id in duplicate_ids:
            db.query(Message).filter(
                Message.project_id == group_project_id,
                Message.conversation_id == duplicate_id,
            ).update({"conversation_id": canonical_id}, synchronize_session=False)

            db.query(Notification).filter(
                Notification.project_id == group_project_id,
                Notification.reference_id == duplicate_id,
                Notification.kind.in_(["new_message", "admin_broadcast"]),
            ).update({"reference_id": canonical_id}, synchronize_session=False)

            hidden_rows = list(
                db.scalars(
                    select(ConversationHidden).where(
                        ConversationHidden.project_id == group_project_id,
                        ConversationHidden.conversation_id == duplicate_id,
                    )
                ).all()
            )
            for hidden in hidden_rows:
                existing = db.scalar(
                    select(ConversationHidden).where(
                        ConversationHidden.project_id == group_project_id,
                        ConversationHidden.conversation_id == canonical_id,
                        ConversationHidden.user_id == hidden.user_id,
                    )
                )
                if existing:
                    if _coerce_utc(hidden.hidden_at) > _coerce_utc(existing.hidden_at):
                        existing.hidden_at = hidden.hidden_at
                    db.query(ConversationHidden).filter(
                        ConversationHidden.id == hidden.id
                    ).delete(synchronize_session=False)
                else:
                    hidden.conversation_id = canonical_id

            duplicate_conversation = db.get(Conversation, duplicate_id)
            if duplicate_conversation:
                db.delete(duplicate_conversation)
                merged_count += 1

    db.flush()
    return merged_count


def _has_active_operator_assignment(db: Session, *, project_id: int, operator_id: int) -> bool:
    assignment = db.scalar(
        select(OperatorAssignment).where(
            OperatorAssignment.project_id == project_id,
            OperatorAssignment.operator_id == operator_id,
            OperatorAssignment.is_active.is_(True),
        )
    )
    return assignment is not None


def _has_active_member_assignment(db: Session, *, project_id: int, operator_id: int, member_id: int) -> bool:
    assignment = db.scalar(
        select(MemberAssignment).where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.operator_id == operator_id,
            MemberAssignment.member_id == member_id,
            MemberAssignment.is_active.is_(True),
        )
    )
    return assignment is not None


def list_conversations(
    db: Session,
    *,
    project_id: int,
    user: User,
    operator_id: int | None = None,
    member_id: int | None = None,
    conversation_type: str | None = None,
) -> list[Conversation]:
    if user.role == UserRole.ADMIN:
        stmt = select(Conversation).where(Conversation.project_id == project_id)
        hidden_subquery = select(ConversationHidden.conversation_id).where(
            ConversationHidden.project_id == project_id,
            ConversationHidden.user_id == user.id,
        )
        # Admin "Delete for me" on admin<->operator chat now behaves like a
        # message-history clear marker, so admin_operator threads must remain visible.
        stmt = stmt.where(
            or_(
                Conversation.type == ConversationType.ADMIN_OPERATOR,
                Conversation.id.not_in(hidden_subquery),
            )
        )
        if operator_id is not None:
            stmt = stmt.where(Conversation.operator_id == operator_id)
        if member_id is not None:
            stmt = stmt.where(Conversation.member_id == member_id)
        if conversation_type is not None and conversation_type.strip():
            try:
                ct = ConversationType(conversation_type.strip().lower())
                stmt = stmt.where(Conversation.type == ct)
            except ValueError:
                # Ignore invalid type filters and return all conversation types
                pass
        stmt = stmt.order_by(Conversation.created_at.desc())
        conversations = list(db.scalars(stmt).all())
        return _filter_canonical_admin_operator_conversations(
            db,
            project_id=project_id,
            conversations=conversations,
        )

    # GROUP: include groups where user is participant
    group_ids = db.scalars(
        select(ConversationParticipant.conversation_id).where(
            ConversationParticipant.user_id == user.id,
        )
    ).all()
    group_convs = list(
        db.scalars(
            select(Conversation).where(
                Conversation.project_id == project_id,
                Conversation.type == ConversationType.GROUP,
                Conversation.id.in_(group_ids),
            ).order_by(Conversation.created_at.desc())
        ).all()
    ) if group_ids else []

    if user.role == UserRole.OPERATOR:
        if not _has_active_operator_assignment(db, project_id=project_id, operator_id=user.id):
            # Terminated/removed operators can only access admin<->operator thread (help path).
            conversations = list(
                db.scalars(
                    select(Conversation)
                    .where(
                        Conversation.project_id == project_id,
                        Conversation.type == ConversationType.ADMIN_OPERATOR,
                        Conversation.operator_id == user.id,
                    )
                    .order_by(Conversation.created_at.desc())
                ).all()
            )
            return _filter_canonical_admin_operator_conversations(
                db,
                project_id=project_id,
                conversations=conversations,
            )

        active_member_assignments = db.scalars(
            select(MemberAssignment).where(
                MemberAssignment.project_id == project_id,
                MemberAssignment.operator_id == user.id,
                MemberAssignment.is_active.is_(True),
            )
        ).all()
        active_member_ids = {assignment.member_id for assignment in active_member_assignments}

        convs = list(
            db.scalars(
                select(Conversation)
                .where(Conversation.project_id == project_id, Conversation.operator_id == user.id)
                .order_by(Conversation.created_at.desc())
            ).all()
        )

        operator_member_conv_ids = [c.id for c in convs if c.type == ConversationType.OPERATOR_MEMBER]
        conversation_with_messages_ids: set[int] = set()
        if operator_member_conv_ids:
            conversation_with_messages_ids = set(
                db.scalars(
                    select(Message.conversation_id)
                    .where(
                        Message.project_id == project_id,
                        Message.conversation_id.in_(operator_member_conv_ids),
                    )
                    .distinct()
                ).all()
            )

        visible: list[Conversation] = []
        for conv in convs:
            if conv.type == ConversationType.ADMIN_OPERATOR:
                visible.append(conv)
                continue

            if conv.member_id is None:
                continue
            if conv.member_id in active_member_ids and conv.id in conversation_with_messages_ids:
                visible.append(conv)
        return group_convs + _filter_canonical_admin_operator_conversations(
            db,
            project_id=project_id,
            conversations=visible,
        )

    active_assignments = db.scalars(
        select(MemberAssignment).where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.member_id == user.id,
            MemberAssignment.is_active.is_(True),
        )
    ).all()
    active_operator_ids = {assignment.operator_id for assignment in active_assignments}

    convs = list(
        db.scalars(
            select(Conversation)
            .where(
                Conversation.project_id == project_id,
                Conversation.type == ConversationType.OPERATOR_MEMBER,
                Conversation.member_id == user.id,
            )
            .order_by(Conversation.created_at.desc())
        ).all()
    )

    member_convs = [
        conv
        for conv in convs
        if conv.member_id is not None
        and conv.operator_id in active_operator_ids
    ]
    return group_convs + member_convs


def assert_conversation_access(db: Session, *, conversation: Conversation, project_id: int, user: User) -> None:
    if conversation.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    if user.role == UserRole.ADMIN:
        return

    if conversation.type == ConversationType.GROUP:
        is_participant = db.scalar(
            select(ConversationParticipant).where(
                ConversationParticipant.conversation_id == conversation.id,
                ConversationParticipant.user_id == user.id,
            )
        ) is not None
        if not is_participant and user.role != UserRole.ADMIN:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not a participant in this group")
        return

    if user.role == UserRole.OPERATOR:
        if conversation.operator_id != user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator cannot access this conversation")
        if not _has_active_operator_assignment(db, project_id=project_id, operator_id=user.id):
            # Keep help-channel access for terminated operators.
            if conversation.type != ConversationType.ADMIN_OPERATOR:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator is not assigned to this project")
            return
        if conversation.type == ConversationType.OPERATOR_MEMBER:
            if conversation.member_id is None or not _has_active_member_assignment(
                db,
                project_id=project_id,
                operator_id=user.id,
                member_id=conversation.member_id,
            ):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Member is not assigned to this operator")
        return

    if conversation.type != ConversationType.OPERATOR_MEMBER or conversation.member_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Member cannot access this conversation")

    if not _has_active_member_assignment(
        db,
        project_id=project_id,
        operator_id=conversation.operator_id,
        member_id=user.id,
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Member is not actively assigned in this project")


def hide_conversation_for_admin(db: Session, *, project_id: int, conversation_id: int, admin: User) -> None:
    if admin.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    conv = get_conversation_or_404(db, conversation_id)
    if conv.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found in this project")
    if conv.type != ConversationType.ADMIN_OPERATOR:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chat clear is supported only for admin-operator conversations",
        )
    _upsert_admin_conversation_hidden(
        db,
        project_id=project_id,
        conversation_id=conversation_id,
        admin_id=admin.id,
    )


def _upsert_admin_conversation_hidden(
    db: Session,
    *,
    project_id: int,
    conversation_id: int,
    admin_id: int,
) -> None:
    existing = db.scalar(
        select(ConversationHidden).where(
            ConversationHidden.project_id == project_id,
            ConversationHidden.conversation_id == conversation_id,
            ConversationHidden.user_id == admin_id,
        )
    )
    if existing:
        existing.hidden_at = now_utc()
        db.flush()
        return
    db.add(
        ConversationHidden(
            project_id=project_id,
            conversation_id=conversation_id,
            user_id=admin_id,
            hidden_at=now_utc(),
        )
    )
    db.flush()


def hide_conversations_for_admin_bulk(
    db: Session,
    *,
    project_id: int,
    conversation_ids: list[int],
    admin: User,
) -> list[Conversation]:
    if admin.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    seen: set[int] = set()
    hidden: list[Conversation] = []
    for conversation_id in conversation_ids:
        if conversation_id in seen:
            continue
        seen.add(conversation_id)
        conversation = get_conversation_or_404(db, conversation_id)
        if conversation.project_id != project_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found in this project")
        if conversation.type != ConversationType.OPERATOR_MEMBER:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Hide selected supports operator-member conversations only",
            )
        _upsert_admin_conversation_hidden(
            db,
            project_id=project_id,
            conversation_id=conversation.id,
            admin_id=admin.id,
        )
        hidden.append(conversation)
    db.flush()
    return hidden


def _validate_admin_clear(
    *,
    admin: User,
    project_id: int,
    conversation: Conversation,
    scope: str,
) -> None:
    if admin.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    if conversation.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found in this project")
    if conversation.type not in {ConversationType.ADMIN_OPERATOR, ConversationType.OPERATOR_MEMBER}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Chat clear is supported only for admin-operator and operator-member conversations",
        )
    if scope not in {"me", "all"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid delete scope")
    if scope == "me" and conversation.type != ConversationType.ADMIN_OPERATOR:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Delete for me is supported only for admin-operator conversations",
        )


def _clear_conversation_history(
    db: Session,
    *,
    project_id: int,
    conversation_id: int,
) -> None:
    db.execute(
        delete(Notification).where(
            Notification.project_id == project_id,
            Notification.reference_id == conversation_id,
        )
    )
    db.execute(
        delete(Message).where(
            Message.project_id == project_id,
            Message.conversation_id == conversation_id,
        )
    )
    db.execute(
        delete(ConversationHidden).where(
            ConversationHidden.project_id == project_id,
            ConversationHidden.conversation_id == conversation_id,
        )
    )


def delete_conversation(
    db: Session,
    *,
    project_id: int,
    conversation_id: int,
    admin: User,
    scope: str = "all",
) -> Conversation:
    """Admin chat clear with two scopes: me (personal clear) or all (clear for both sides)."""
    conv = get_conversation_or_404(db, conversation_id)
    _validate_admin_clear(admin=admin, project_id=project_id, conversation=conv, scope=scope)

    if scope == "me":
        hide_conversation_for_admin(
            db,
            project_id=project_id,
            conversation_id=conversation_id,
            admin=admin,
        )
        return conv

    _clear_conversation_history(
        db,
        project_id=project_id,
        conversation_id=conversation_id,
    )
    db.flush()
    return conv


def delete_conversations_bulk(
    db: Session,
    *,
    project_id: int,
    conversation_ids: list[int],
    admin: User,
) -> list[Conversation]:
    seen: set[int] = set()
    conversations: list[Conversation] = []
    for conversation_id in conversation_ids:
        if conversation_id in seen:
            continue
        seen.add(conversation_id)
        conversation = get_conversation_or_404(db, conversation_id)
        _validate_admin_clear(admin=admin, project_id=project_id, conversation=conversation, scope="all")
        _clear_conversation_history(
            db,
            project_id=project_id,
            conversation_id=conversation_id,
        )
        conversations.append(conversation)
    db.flush()
    return conversations


def get_clear_event_targets(
    db: Session,
    *,
    project_id: int,
    conversation: Conversation,
    scope: str,
    requester_admin_id: int,
) -> set[int]:
    if scope == "me":
        return {requester_admin_id}

    targets: set[int] = {requester_admin_id}
    if conversation.type == ConversationType.ADMIN_OPERATOR:
        targets.update(_list_active_project_admin_ids(db, project_id=project_id))
        targets.add(conversation.operator_id)
        return targets

    targets.add(conversation.operator_id)
    if conversation.member_id is not None:
        targets.add(conversation.member_id)
    return targets


def get_conversation_or_404(db: Session, conversation_id: int) -> Conversation:
    conversation = db.scalar(select(Conversation).where(Conversation.id == conversation_id))
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")
    return conversation


def list_messages(
    db: Session,
    *,
    project_id: int,
    conversation_id: int,
    user: User,
    limit: int = 50,
    offset: int = 0,
) -> list[Message]:
    conversation = get_conversation_or_404(db, conversation_id)
    assert_conversation_access(db, conversation=conversation, project_id=project_id, user=user)

    stmt = (
        select(Message)
        .where(Message.project_id == project_id, Message.conversation_id == conversation_id)
    )
    clear_cutoff = _get_personal_clear_cutoff(
        db,
        project_id=project_id,
        conversation=conversation,
        user_id=user.id,
    )
    if clear_cutoff:
        stmt = stmt.where(Message.created_at > clear_cutoff)
    stmt = stmt.order_by(Message.created_at.desc()).offset(offset).limit(limit)
    return list(reversed(list(db.scalars(stmt).all())))


def create_message(
    db: Session,
    *,
    project_id: int,
    conversation_id: int,
    sender: User,
    content: str,
    conversation: Conversation | None = None,
    message_type: MessageType = MessageType.TEXT,
    attachment_url: str | None = None,
    attachment_filename: str | None = None,
    attachment_mime: str | None = None,
) -> Message:
    raw = content.strip()
    if not raw:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message content cannot be empty")
    clean_content = raw

    conversation = conversation or get_conversation_or_404(db, conversation_id)
    assert_conversation_access(db, conversation=conversation, project_id=project_id, user=sender)

    # Prevent terminated/removed users from sending messages
    sender_role = _normalize_user_role(sender.role)
    membership = db.scalar(
        select(ProjectUser).where(
            ProjectUser.project_id == project_id,
            ProjectUser.user_id == sender.id,
        )
    )
    if sender_role != UserRole.ADMIN.value:
        active_membership = db.scalar(
            select(ProjectUser).where(
                ProjectUser.project_id == project_id,
                ProjectUser.user_id == sender.id,
                ProjectUser.status == MembershipStatus.ACTIVE,
            )
        )
        if not active_membership:
            # Terminated operator can still send help notes to admin in admin_operator conversation.
            if not (
                sender_role == UserRole.OPERATOR.value
                and membership is not None
                and membership.status == MembershipStatus.TERMINATED
                and conversation.type == ConversationType.ADMIN_OPERATOR
                and sender.id == conversation.operator_id
                and message_type == MessageType.TEXT
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Your account has been terminated",
                )

    if sender_role == UserRole.OPERATOR.value and membership is not None and membership.status == MembershipStatus.TERMINATED:
        if conversation.type != ConversationType.ADMIN_OPERATOR:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Your account has been terminated",
            )

    # Defensive normalization: DB/driver/enum combinations can return enum objects or
    # strings like "UserRole.ADMIN". Normalize to ADMIN/OPERATOR/MEMBER.
    role_val = sender_role

    if conversation.type == ConversationType.ADMIN_OPERATOR:
        if role_val == UserRole.ADMIN.value:
            if not _is_active_project_admin(db, project_id=project_id, user_id=sender.id):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin mismatch")
        elif role_val == UserRole.OPERATOR.value:
            if sender.id != conversation.operator_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator mismatch")
            has_active_assignment = _has_active_operator_assignment(db, project_id=project_id, operator_id=sender.id)
            is_terminated_help_mode = (
                membership is not None
                and membership.status == MembershipStatus.TERMINATED
                and sender.id == conversation.operator_id
            )
            if not has_active_assignment and not is_terminated_help_mode:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator is not assigned to project")
        else:
            logger.warning(
                "ADMIN_OPERATOR role not allowed: user_id=%s role_val=%s raw_role=%r raw_type=%s conv_id=%s",
                sender.id,
                role_val,
                sender.role,
                type(sender.role).__name__,
                conversation.id,
            )
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admin and operator can use this conversation")
        # Allow:
        # - OPERATOR -> ADMIN_OPERATOR only as TEXT
        # - ADMIN -> ADMIN_OPERATOR as TEXT (direct) or ADMIN_BROADCAST (broadcast-style)
        if role_val == UserRole.OPERATOR.value and message_type != MessageType.TEXT:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message type")
        if role_val == UserRole.ADMIN.value and message_type not in {MessageType.TEXT, MessageType.ADMIN_BROADCAST}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message type")

    if conversation.type == ConversationType.GROUP:
        if message_type != MessageType.TEXT:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid message type for group")
        # Prevent same-role chatting inside group conversations:
        # - Operators cannot message another operator (even via group)
        # - Members cannot message another member (even via group)
        if role_val in {UserRole.OPERATOR.value, UserRole.MEMBER.value}:
            other_same_role_exists = db.scalar(
                select(User.id).select_from(ConversationParticipant).join(User, User.id == ConversationParticipant.user_id).where(
                    ConversationParticipant.conversation_id == conversation.id,
                    ConversationParticipant.user_id != sender.id,
                    User.role == (sender.role if hasattr(sender.role, "value") else UserRole(role_val)),
                    User.is_active.is_(True),
                )
            ) is not None
            if other_same_role_exists:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Same-role chatting is not allowed in group conversations",
                )
        # assert_conversation_access already verified sender is participant or admin

    if conversation.type == ConversationType.OPERATOR_MEMBER:
        if role_val == UserRole.OPERATOR.value:
            if sender.id != conversation.operator_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Operator mismatch")
            if conversation.member_id is None or not _has_active_member_assignment(
                db,
                project_id=project_id,
                operator_id=sender.id,
                member_id=conversation.member_id,
            ):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Member is not assigned to this operator")
        elif role_val == UserRole.MEMBER.value:
            if sender.id != conversation.member_id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Member mismatch")
            if not _has_active_member_assignment(
                db,
                project_id=project_id,
                operator_id=conversation.operator_id,
                member_id=sender.id,
            ):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Member is not actively assigned")
            if message_type != MessageType.TEXT:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Member message type not allowed")
        elif role_val == UserRole.ADMIN.value:
            if message_type != MessageType.ADMIN_BROADCAST:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Admins can send to members only through admin_broadcast messages",
                )
        else:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Role is not allowed")

    message = Message(
        conversation_id=conversation.id,
        project_id=project_id,
        sender_user_id=sender.id,
        sender_role=sender.role,
        content=clean_content,
        message_type=message_type,
        attachment_url=attachment_url,
        attachment_filename=attachment_filename,
        attachment_mime=attachment_mime,
        created_at=_next_message_timestamp(
            db,
            project_id=project_id,
            conversation=conversation,
        ),
    )
    db.add(message)
    db.flush()

    if conversation.type == ConversationType.OPERATOR_MEMBER:
        from app.services import chat_session_service

        chat_session_service.on_message_persisted(
            db,
            conversation=conversation,
            sender_role=UserRole(role_val),
            created_at=message.created_at,
        )

    return message


def resolve_broadcast_targets(
    db: Session,
    *,
    project_id: int,
    target_member_ids: list[int] | None,
    all_members: bool,
    target_operator_ids: list[int] | None = None,
    all_operators: bool = False,
) -> set[int]:
    targets = set()
    member_requested = bool(all_members) or bool(target_member_ids)
    operator_requested = bool(all_operators) or bool(target_operator_ids)

    if not member_requested and not operator_requested:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No broadcast targets specified")

    if member_requested:
        assignment_stmt = select(MemberAssignment.member_id).where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.is_active.is_(True),
        )
        if not all_members:
            if not target_member_ids:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="member_ids required when all_members is false")
            assignment_stmt = assignment_stmt.where(MemberAssignment.member_id.in_(target_member_ids))
        targets.update(db.scalars(assignment_stmt).all())

    if operator_requested:
        operator_stmt = select(OperatorAssignment.operator_id).where(
            OperatorAssignment.project_id == project_id,
            OperatorAssignment.is_active.is_(True),
        )
        if not all_operators:
            if not target_operator_ids:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="operator_ids required when all_operators is false")
            operator_stmt = operator_stmt.where(OperatorAssignment.operator_id.in_(target_operator_ids))
        targets.update(db.scalars(operator_stmt).all())

    return targets


def broadcast_admin_message(
    db: Session,
    *,
    project_id: int,
    admin: User,
    target_member_ids: list[int] | None,
    all_members: bool,
    target_operator_ids: list[int] | None = None,
    all_operators: bool = False,
    content: str,
) -> list[Message]:
    if not content.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Broadcast content cannot be empty")
    if admin.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")

    messages: list[Message] = []

    member_requested = bool(all_members) or bool(target_member_ids)
    operator_requested = bool(all_operators) or bool(target_operator_ids)
    if not member_requested and not operator_requested:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No broadcast targets specified")

    if member_requested:
        assignment_stmt = select(MemberAssignment).where(
            MemberAssignment.project_id == project_id,
            MemberAssignment.is_active.is_(True),
        )
        if not all_members:
            if not target_member_ids:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="member_ids required when all_members is false")
            assignment_stmt = assignment_stmt.where(MemberAssignment.member_id.in_(target_member_ids))

        assignments = list(db.scalars(assignment_stmt).all())
        for assignment in assignments:
            conv = get_or_create_operator_member_conversation(
                db,
                project_id=project_id,
                operator_id=assignment.operator_id,
                member_id=assignment.member_id,
            )
            msg = create_message(
                db,
                project_id=project_id,
                conversation_id=conv.id,
                sender=admin,
                content=content,
                message_type=MessageType.ADMIN_BROADCAST,
            )
            messages.append(msg)

    if operator_requested:
        operator_stmt = select(OperatorAssignment.operator_id).where(
            OperatorAssignment.project_id == project_id,
            OperatorAssignment.is_active.is_(True),
        )
        if not all_operators:
            if not target_operator_ids:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="operator_ids required when all_operators is false")
            operator_stmt = operator_stmt.where(OperatorAssignment.operator_id.in_(target_operator_ids))

        operator_ids = list(db.scalars(operator_stmt).all())
        # De-dup ids to avoid creating multiple messages per operator
        for op_id in set(operator_ids):
            conv = get_or_create_admin_operator_conversation(
                db,
                project_id=project_id,
                admin_id=admin.id,
                operator_id=op_id,
            )
            msg = create_message(
                db,
                project_id=project_id,
                conversation_id=conv.id,
                sender=admin,
                content=content,
                message_type=MessageType.ADMIN_BROADCAST,
            )
            messages.append(msg)

    return messages


def get_message_recipients(db: Session, *, project_id: int, conversation_id: int) -> set[int]:
    conversation = get_conversation_or_404(db, conversation_id)
    recipients: set[int] = set()

    if conversation.type == ConversationType.ADMIN_OPERATOR:
        if conversation.admin_id is not None:
            recipients.add(conversation.admin_id)
        recipients.add(conversation.operator_id)

    if conversation.type == ConversationType.OPERATOR_MEMBER:
        recipients.add(conversation.operator_id)
        if conversation.member_id is not None:
            recipients.add(conversation.member_id)

    if conversation.type == ConversationType.GROUP:
        participant_ids = db.scalars(
            select(ConversationParticipant.user_id).where(ConversationParticipant.conversation_id == conversation_id)
        ).all()
        recipients.update(participant_ids)

    project_admin_ids = _list_active_project_admin_ids(db, project_id=project_id)
    recipients.update(project_admin_ids)

    if not project_admin_ids:
        all_admins = db.scalars(
            select(User.id).where(User.role == UserRole.ADMIN, User.is_active.is_(True))
        ).all()
        recipients.update(all_admins)

    return recipients


def search_messages(db: Session, *, project_id: int, user: User, query: str, limit: int = 50) -> list[Message]:
    """Search messages in project. Role-scoped: admin sees all, operator sees own, member sees own."""
    q = f"%{query.strip()}%"
    base = select(Message).where(Message.project_id == project_id, Message.content.ilike(q))

    if user.role == UserRole.ADMIN:
        stmt = base.order_by(Message.created_at.desc()).limit(limit)
        return list(db.scalars(stmt).all())
    if user.role == UserRole.OPERATOR:
        conv_ids = list(db.scalars(select(Conversation.id).where(
            Conversation.project_id == project_id,
            Conversation.operator_id == user.id,
        )).all())
        group_conv_ids = list(db.scalars(select(ConversationParticipant.conversation_id).where(
            ConversationParticipant.user_id == user.id,
        )).all())
        conv_ids = list(set(conv_ids) | set(group_conv_ids))
        if not conv_ids:
            return []
        stmt = base.where(Message.conversation_id.in_(conv_ids)).order_by(Message.created_at.desc()).limit(limit)
        return list(db.scalars(stmt).all())
    if user.role == UserRole.MEMBER:
        conv_ids = list(db.scalars(select(Conversation.id).where(
            Conversation.project_id == project_id,
            Conversation.type == ConversationType.OPERATOR_MEMBER,
            Conversation.member_id == user.id,
        )).all())
        group_conv_ids = list(db.scalars(select(ConversationParticipant.conversation_id).where(
            ConversationParticipant.user_id == user.id,
        )).all())
        conv_ids = list(set(conv_ids) | set(group_conv_ids))
        if not conv_ids:
            return []
        stmt = base.where(Message.conversation_id.in_(conv_ids)).order_by(Message.created_at.desc()).limit(limit)
        return list(db.scalars(stmt).all())
    return []


def create_group_conversation(
    db: Session,
    *,
    project_id: int,
    admin: User,
    name: str,
    participant_ids: list[int],
) -> Conversation:
    if admin.role != UserRole.ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    if not name.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group name required")
    participant_ids = list(set(participant_ids))
    if not participant_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="At least one participant required")

    # Verify all participants exist and have project access
    for uid in participant_ids:
        u = db.scalar(select(User).where(User.id == uid, User.is_active.is_(True)))
        if not u:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"User {uid} not found")
        pu = db.scalar(select(ProjectUser).where(ProjectUser.project_id == project_id, ProjectUser.user_id == uid, ProjectUser.status == MembershipStatus.ACTIVE))
        if not pu:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"User {uid} is not in this project")

    # Enforce composition constraints to prevent same-role chat loopholes:
    # no more than one operator and no more than one member in a group.
    roles = list(db.scalars(select(User.role).where(User.id.in_(participant_ids), User.is_active.is_(True))).all())
    if roles.count(UserRole.OPERATOR) > 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group cannot include multiple operators")
    if roles.count(UserRole.MEMBER) > 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Group cannot include multiple members")

    conv = Conversation(
        project_id=project_id,
        type=ConversationType.GROUP,
        operator_id=admin.id,
        member_id=None,
        admin_id=admin.id,
        name=name.strip(),
    )
    db.add(conv)
    db.flush()

    for uid in participant_ids:
        db.add(ConversationParticipant(conversation_id=conv.id, user_id=uid))
    db.add(ConversationParticipant(conversation_id=conv.id, user_id=admin.id))

    return conv


def get_conversation_stats(
    db: Session,
    *,
    project_id: int,
    user_id: int,
    conversations: list[Conversation],
) -> dict[int, dict[str, int | datetime | None]]:
    """Batch unread + last message stats for a conversation list."""
    if not conversations:
        return {}

    conversation_ids = [conversation.id for conversation in conversations]
    visibility_clause = or_(
        Conversation.type != ConversationType.ADMIN_OPERATOR,
        ConversationHidden.hidden_at.is_(None),
        Message.created_at > ConversationHidden.hidden_at,
    )

    join_hidden = and_(
        ConversationHidden.project_id == project_id,
        ConversationHidden.user_id == user_id,
        ConversationHidden.conversation_id == Message.conversation_id,
    )
    join_conversation = and_(
        Conversation.id == Message.conversation_id,
        Conversation.project_id == project_id,
    )

    last_message_rows = db.execute(
        select(
            Message.conversation_id,
            func.max(Message.created_at).label("last_message_at"),
        )
        .select_from(Message)
        .join(Conversation, join_conversation)
        .outerjoin(ConversationHidden, join_hidden)
        .where(
            Message.project_id == project_id,
            Message.conversation_id.in_(conversation_ids),
            visibility_clause,
        )
        .group_by(Message.conversation_id)
    ).all()

    unread_rows = db.execute(
        select(
            Message.conversation_id,
            func.count(Message.id).label("unread_count"),
        )
        .select_from(Message)
        .join(Conversation, join_conversation)
        .outerjoin(ConversationHidden, join_hidden)
        .outerjoin(
            MessageRead,
            and_(
                MessageRead.message_id == Message.id,
                MessageRead.user_id == user_id,
            ),
        )
        .where(
            Message.project_id == project_id,
            Message.conversation_id.in_(conversation_ids),
            Message.sender_user_id != user_id,
            MessageRead.id.is_(None),
            visibility_clause,
        )
        .group_by(Message.conversation_id)
    ).all()

    stats: dict[int, dict[str, int | datetime | None]] = {
        conversation.id: {"unread_count": 0, "last_message_at": None}
        for conversation in conversations
    }

    for conversation_id, last_message_at in last_message_rows:
        if conversation_id in stats:
            stats[conversation_id]["last_message_at"] = last_message_at

    for conversation_id, unread_count in unread_rows:
        if conversation_id in stats:
            stats[conversation_id]["unread_count"] = int(unread_count or 0)

    return stats


def get_unread_count(db: Session, *, conversation_id: int, user_id: int, project_id: int) -> int:
    """Count messages in conversation that user received but has not read."""
    from sqlalchemy import exists, func

    subq = select(1).where(
        MessageRead.message_id == Message.id,
        MessageRead.user_id == user_id,
    )
    stmt = (
        select(func.count())
        .select_from(Message)
        .where(
            Message.conversation_id == conversation_id,
            Message.project_id == project_id,
            Message.sender_user_id != user_id,
            ~exists(subq),
        )
    )
    conversation = db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.project_id == project_id,
        )
    )
    clear_cutoff = _get_personal_clear_cutoff(
        db,
        project_id=project_id,
        conversation=conversation,
        user_id=user_id,
    )
    if clear_cutoff:
        stmt = stmt.where(Message.created_at > clear_cutoff)
    return db.scalar(stmt) or 0


def get_last_message_time(db: Session, *, conversation_id: int, user_id: int, project_id: int) -> datetime | None:
    """Get the creation time of the most recent message in a conversation."""
    stmt = select(Message.created_at).where(
        Message.conversation_id == conversation_id,
        Message.project_id == project_id,
    )
    conversation = db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id,
            Conversation.project_id == project_id,
        )
    )
    clear_cutoff = _get_personal_clear_cutoff(
        db,
        project_id=project_id,
        conversation=conversation,
        user_id=user_id,
    )
    if clear_cutoff:
        stmt = stmt.where(Message.created_at > clear_cutoff)
    stmt = stmt.order_by(Message.created_at.desc()).limit(1)
    return db.scalar(stmt)


def _get_personal_clear_cutoff(
    db: Session,
    *,
    project_id: int,
    conversation: Conversation | None,
    user_id: int,
) -> datetime | None:
    if not conversation:
        return None
    if conversation.project_id != project_id:
        return None
    if conversation.type != ConversationType.ADMIN_OPERATOR:
        return None
    if not _is_active_project_admin(db, project_id=project_id, user_id=user_id):
        return None
    return db.scalar(
        select(ConversationHidden.hidden_at).where(
            ConversationHidden.project_id == project_id,
            ConversationHidden.conversation_id == conversation.id,
            ConversationHidden.user_id == user_id,
        )
    )


def _next_message_timestamp(
    db: Session,
    *,
    project_id: int,
    conversation: Conversation,
) -> datetime:
    timestamp = now_utc()
    if conversation.type != ConversationType.ADMIN_OPERATOR:
        return timestamp

    clear_cutoff = db.scalar(
        select(func.max(ConversationHidden.hidden_at)).where(
            ConversationHidden.project_id == project_id,
            ConversationHidden.conversation_id == conversation.id,
        )
    )
    if clear_cutoff is None:
        return timestamp

    normalized_cutoff = _coerce_utc(clear_cutoff)
    if timestamp <= normalized_cutoff:
        return normalized_cutoff + timedelta(microseconds=1)
    return timestamp


def get_message_read_by(db: Session, message_ids: list[int]) -> dict[int, list[int]]:
    """Return {message_id: [user_id, ...]} for given message IDs."""
    if not message_ids:
        return {}
    rows = db.execute(
        select(MessageRead.message_id, MessageRead.user_id).where(MessageRead.message_id.in_(message_ids))
    ).all()
    result: dict[int, list[int]] = {mid: [] for mid in message_ids}
    for mid, uid in rows:
        result[mid].append(uid)
    return result


def mark_message_read(db: Session, *, message_id: int, user_id: int, project_id: int) -> None:
    msg = db.scalar(select(Message).where(Message.id == message_id, Message.project_id == project_id))
    if not msg:
        return
    existing = db.scalar(select(MessageRead).where(MessageRead.message_id == message_id, MessageRead.user_id == user_id))
    if not existing:
        db.add(MessageRead(message_id=message_id, user_id=user_id))
    
    from app.services import notification_service
    notification_service.mark_read_by_reference(
        db, project_id=project_id, user_id=user_id, reference_id=msg.conversation_id
    )


def presence_payload(user_id: int, project_id: int, is_online: bool, last_seen_at: datetime | None = None) -> dict:
    return {
        "event": "presence:update",
        "data": {
            "user_id": user_id,
            "project_id": project_id,
            "is_online": is_online,
            "last_seen_at": last_seen_at.isoformat() if last_seen_at else None,
        },
    }


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
