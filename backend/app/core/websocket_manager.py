import asyncio
import logging
import threading
from collections import defaultdict

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[int, dict[int, set[WebSocket]]] = defaultdict(lambda: defaultdict(set))
        self._lock = asyncio.Lock()
        self._app_loop: asyncio.AbstractEventLoop | None = None
        self._app_loop_owner_thread_id: int | None = None

    def set_app_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._app_loop = loop
        self._app_loop_owner_thread_id = threading.get_ident()

    async def connect(self, project_id: int, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[project_id][user_id].add(websocket)

    async def disconnect(self, project_id: int, user_id: int, websocket: WebSocket) -> None:
        async with self._lock:
            user_bag = self._connections.get(project_id, {}).get(user_id)
            if not user_bag:
                return
            user_bag.discard(websocket)
            if not user_bag:
                self._connections[project_id].pop(user_id, None)
            if not self._connections[project_id]:
                self._connections.pop(project_id, None)

    async def _send_socket(self, project_id: int, user_id: int, socket: WebSocket, payload: dict) -> WebSocket | None:
        try:
            await socket.send_json(payload)
            return None
        except Exception:
            logger.warning(
                "Dropping stale websocket during send",
                extra={"project_id": project_id, "user_id": user_id},
                exc_info=True,
            )
            return socket

    async def send_to_user(self, project_id: int, user_id: int, payload: dict) -> None:
        sockets = list(self._connections.get(project_id, {}).get(user_id, set()))
        if not sockets:
            return

        stale_sockets = await asyncio.gather(
            *(self._send_socket(project_id, user_id, socket, payload) for socket in sockets)
        )
        for socket in stale_sockets:
            if socket is not None:
                await self.disconnect(project_id, user_id, socket)

    async def broadcast_to_users(self, project_id: int, user_ids: list[int], payload: dict) -> None:
        targets = list(dict.fromkeys(user_ids))
        if not targets:
            return
        await asyncio.gather(*(self.send_to_user(project_id, user_id, payload) for user_id in targets))

    def dispatch_broadcast_to_users(self, project_id: int, user_ids: list[int], payload: dict) -> None:
        """
        Thread-safe fire-and-forget dispatch for sync code paths.
        Uses the FastAPI app loop when available instead of creating ad-hoc event loops.
        """
        targets = list(dict.fromkeys(user_ids))
        if not targets:
            return

        coro = self.broadcast_to_users(project_id, targets, payload)

        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None

        if running_loop is not None:
            running_loop.create_task(coro)
            return

        if self._app_loop and self._app_loop.is_running():
            asyncio.run_coroutine_threadsafe(coro, self._app_loop)
            return

        # Fallback for tests/utility scripts where no app loop is registered yet.
        asyncio.run(coro)

    async def has_user_connections(self, project_id: int, user_id: int) -> bool:
        """True if the given user still has at least one active websocket."""
        async with self._lock:
            return bool(self._connections.get(project_id, {}).get(user_id))


manager = ConnectionManager()
