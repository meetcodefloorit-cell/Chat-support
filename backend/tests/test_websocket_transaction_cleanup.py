from sqlalchemy import select

from app.main import release_db_transaction_if_open
from app.models import Project


def test_release_db_transaction_if_open_rolls_back_active_transaction(db):
    db.scalar(select(Project.id))
    assert db.in_transaction() is True

    release_db_transaction_if_open(db)

    assert db.in_transaction() is False


def test_release_db_transaction_if_open_noop_when_clean(db):
    if db.in_transaction():
        db.rollback()

    release_db_transaction_if_open(db)

    assert db.in_transaction() is False
