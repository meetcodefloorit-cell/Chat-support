from app.api import realtime


def test_broadcast_project_refresh_dispatches_once(monkeypatch):
    calls: list[tuple[int, list[int], dict]] = []

    def _fake_dispatch(project_id: int, user_ids: list[int], payload: dict) -> None:
        calls.append((project_id, user_ids, payload))

    monkeypatch.setattr(realtime.manager, "dispatch_broadcast_to_users", _fake_dispatch)

    realtime.broadcast_project_refresh_sync(
        project_id=17,
        user_ids=[11, 12, 11],
        reason="member_reassigned",
    )

    assert len(calls) == 1
    project_id, user_ids, payload = calls[0]
    assert project_id == 17
    assert user_ids == [11, 12]
    assert payload == {"event": "project:refresh", "data": {"reason": "member_reassigned"}}


def test_broadcast_project_refresh_skips_empty_targets(monkeypatch):
    called = False

    def _fake_dispatch(project_id: int, user_ids: list[int], payload: dict) -> None:
        nonlocal called
        called = True

    monkeypatch.setattr(realtime.manager, "dispatch_broadcast_to_users", _fake_dispatch)

    realtime.broadcast_project_refresh_sync(project_id=8, user_ids=[], reason="noop")

    assert called is False


def test_broadcast_members_changed_dispatches_once(monkeypatch):
    calls: list[tuple[int, list[int], dict]] = []

    def _fake_dispatch(project_id: int, user_ids: list[int], payload: dict) -> None:
        calls.append((project_id, user_ids, payload))

    monkeypatch.setattr(realtime.manager, "dispatch_broadcast_to_users", _fake_dispatch)

    realtime.broadcast_members_changed_sync(
        project_id=21,
        user_ids=[7, 8, 7],
        reason="member_created",
    )

    assert calls == [
        (
            21,
            [7, 8],
            {"event": "members:changed", "data": {"reason": "member_created"}},
        )
    ]


def test_broadcast_conversation_remove_dispatches_once(monkeypatch):
    calls: list[tuple[int, list[int], dict]] = []

    def _fake_dispatch(project_id: int, user_ids: list[int], payload: dict) -> None:
        calls.append((project_id, user_ids, payload))

    monkeypatch.setattr(realtime.manager, "dispatch_broadcast_to_users", _fake_dispatch)

    realtime.broadcast_conversation_remove_sync(
        project_id=9,
        user_ids=[3, 4],
        conversation_id=77,
        reason="not_visible",
    )

    assert calls == [
        (
            9,
            [3, 4],
            {
                "event": "conversation:remove",
                "data": {"conversation_id": 77, "reason": "not_visible"},
            },
        )
    ]
