from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

db_url = settings.effective_database_url
engine_kwargs: dict = {"pool_pre_ping": True}

driver_name = make_url(db_url).drivername
if driver_name.startswith("postgresql"):
    engine_kwargs.update(
        pool_size=max(1, settings.db_pool_size),
        max_overflow=max(0, settings.db_max_overflow),
        pool_timeout=max(1, settings.db_pool_timeout),
        pool_recycle=max(30, settings.db_pool_recycle_seconds),
        pool_use_lifo=True,
    )

engine = create_engine(db_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
