"""Create and list in-app notifications."""

from datetime import datetime, timezone
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Notification, User


def create_notification(
    db: Session,
    *,
    project_id: int,
    user_id: int,
    kind: str,
    title: str,
    reference_id: int | None = None,
) -> Notification:
    n = Notification(
        project_id=project_id,
        user_id=user_id,
        kind=kind,
        reference_id=reference_id,
        title=title,
    )
    db.add(n)
    db.flush()
    return n


def list_notifications(
    db: Session,
    *,
    project_id: int,
    user_id: int,
    limit: int = 50,
    offset: int = 0,
    unread_only: bool = False,
) -> list[Notification]:
    stmt = select(Notification).where(
        Notification.project_id == project_id,
        Notification.user_id == user_id,
    )
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    stmt = stmt.order_by(Notification.created_at.desc()).offset(offset).limit(limit)
    return list(db.scalars(stmt).all())


def count_unread(db: Session, *, project_id: int, user_id: int) -> int:
    r = db.scalar(
        select(func.count(Notification.id)).where(
            Notification.project_id == project_id,
            Notification.user_id == user_id,
            Notification.read_at.is_(None),
        )
    )
    return r or 0


def count_unread_bulk(db: Session, *, project_id: int, user_ids: set[int] | list[int]) -> dict[int, int]:
    targets = list(dict.fromkeys(user_ids))
    if not targets:
        return {}

    rows = db.execute(
        select(Notification.user_id, func.count(Notification.id))
        .where(
            Notification.project_id == project_id,
            Notification.user_id.in_(targets),
            Notification.read_at.is_(None),
        )
        .group_by(Notification.user_id)
    ).all()

    counts = {int(user_id): int(count or 0) for user_id, count in rows}
    for user_id in targets:
        counts.setdefault(int(user_id), 0)
    return counts


def mark_read(db: Session, *, notification_id: int, user_id: int) -> bool:
    n = db.scalar(select(Notification).where(Notification.id == notification_id, Notification.user_id == user_id))
    if not n:
        return False
    n.read_at = datetime.now(timezone.utc)
    return True


def mark_all_read(db: Session, *, project_id: int, user_id: int) -> int:
    notifications = list(
        db.scalars(
            select(Notification).where(
                Notification.project_id == project_id,
                Notification.user_id == user_id,
                Notification.read_at.is_(None),
            )
        ).all()
    )
    now = datetime.now(timezone.utc)
    for n in notifications:
        n.read_at = now
    return len(notifications)


def mark_read_by_reference(db: Session, *, project_id: int, user_id: int, reference_id: int) -> int:
    notifications = list(
        db.scalars(
            select(Notification).where(
                Notification.project_id == project_id,
                Notification.user_id == user_id,
                Notification.reference_id == reference_id,
                Notification.read_at.is_(None),
            )
        ).all()
    )
    now = datetime.now(timezone.utc)
    for n in notifications:
        n.read_at = now
    return len(notifications)
