import asyncio

from app.core.websocket_manager import ConnectionManager


class DummySocket:
    def __init__(self, *, fail_on_send: bool = False) -> None:
        self.fail_on_send = fail_on_send
        self.accepted = False
        self.messages: list[dict] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, payload: dict) -> None:
        if self.fail_on_send:
            raise RuntimeError("socket closed")
        self.messages.append(payload)


def test_send_to_user_drops_stale_socket_and_keeps_sending() -> None:
    async def scenario() -> None:
        manager = ConnectionManager()
        dead_socket = DummySocket(fail_on_send=True)
        live_socket = DummySocket()

        await manager.connect(project_id=7, user_id=21, websocket=dead_socket)
        await manager.connect(project_id=7, user_id=21, websocket=live_socket)

        await manager.send_to_user(7, 21, {"event": "message:new", "data": {"id": 1}})

        assert dead_socket.accepted is True
        assert live_socket.accepted is True
        assert live_socket.messages == [{"event": "message:new", "data": {"id": 1}}]
        assert await manager.has_user_connections(7, 21) is True

        remaining = manager._connections[7][21]
        assert dead_socket not in remaining
        assert live_socket in remaining

    asyncio.run(scenario())


def test_broadcast_to_users_continues_after_stale_socket_failure() -> None:
    async def scenario() -> None:
        manager = ConnectionManager()
        dead_socket = DummySocket(fail_on_send=True)
        admin_socket = DummySocket()
        operator_socket = DummySocket()

        await manager.connect(project_id=9, user_id=1, websocket=dead_socket)
        await manager.connect(project_id=9, user_id=1, websocket=admin_socket)
        await manager.connect(project_id=9, user_id=2, websocket=operator_socket)

        await manager.broadcast_to_users(9, [1, 2], {"event": "message:new", "data": {"id": 55}})

        assert admin_socket.messages == [{"event": "message:new", "data": {"id": 55}}]
        assert operator_socket.messages == [{"event": "message:new", "data": {"id": 55}}]

    asyncio.run(scenario())
