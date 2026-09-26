"""
Server-side enforcement for chat session timing that keeps running even if every
operator/member browser is closed or disconnected (spec section 25).

Deliberately implemented as a lightweight in-process asyncio loop on the existing FastAPI
event loop -- this stack has no Celery/Redis/task-queue infrastructure to reuse, and the
requirement is "server-side enforcement", not any particular scheduler technology.
"""

import asyncio
import logging

from app.api.realtime import broadcast_chat_session_update
from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Conversation
from app.services import chat_session_service

logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None


async def _run_sweep_once() -> None:
    db = SessionLocal()
    try:
        chat_session_service.sweep_sla_breaches(db)
        expired = chat_session_service.sweep_expired_sessions(db)
        db.commit()

        for session in expired:
            db.refresh(session)
            conversation = db.get(Conversation, session.conversation_id)
            if conversation is not None:
                await broadcast_chat_session_update(
                    db, project_id=session.project_id, conversation=conversation, session=session,
                )
    except Exception:
        db.rollback()
        logger.exception("chat_session sweep failed")
    finally:
        db.close()


async def _sweep_loop() -> None:
    interval = max(1, settings.chat_session_sweep_interval_seconds)
    while True:
        try:
            await _run_sweep_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("chat_session sweep loop iteration failed")
        await asyncio.sleep(interval)


def start_chat_session_scheduler() -> None:
    global _task
    if _task is not None and not _task.done():
        return
    _task = asyncio.get_event_loop().create_task(_sweep_loop())
    logger.info("chat_session scheduler started (interval=%ss)", settings.chat_session_sweep_interval_seconds)


def stop_chat_session_scheduler() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        _task = None
