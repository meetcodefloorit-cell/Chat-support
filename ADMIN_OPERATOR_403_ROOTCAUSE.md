# ADMIN -> OPERATOR WebSocket 403 Root Cause

## 1) Exact websocket flow when admin sends a message
1. Admin frontend sends WS payload:
   - `{"event":"message","conversation_id":<cid>,"content":"..."}` over `/ws?token=...&project_id=<pid>`
2. Backend receives the WS message in `backend/app/main.py` inside `websocket_endpoint()`:
   - `if event == "message": ...`
3. On each `"message"` event, backend:
   - Parses `conversation_id` and `content`
   - Re-fetches conversation from DB
   - Calls `conversation_service.create_message(...)` with the socket-connect resolved sender `user`
4. If `create_message()` raises `HTTPException`, backend sends:
   - `{"event":"error","detail":he.detail}`
   - and does not crash the socket loop.

## 2) Where sender user is resolved
Sender is resolved once at socket connect time in `backend/app/main.py`:
- `user = db.scalar(select(User).where(User.id == int(sub), User.is_active.is_(True)))`
- The same `user` object is then used for all subsequent `"message"` events.
- If `user` is missing/inactive, the socket closes with code `4401`.

## 3) Where conversation is resolved
In `backend/app/main.py` `"message"` handling:
- conversation is resolved per message as:
  - `conversation = conversation_service.get_conversation_or_404(db, conversation_id)`

Then `create_message()` performs:
- canonical permission checks against the resolved conversation.

## 4) Exact conversation type being used
The failing path is the direct admin <-> operator conversation:
- `ConversationType.ADMIN_OPERATOR` (string value: `"admin_operator"`)

## 5) Exact reason `create_message()` throws 403
`backend/app/services/conversation_service.py:create_message()` throws:
- `403: Only admin and operator can use this conversation`

Reason:
- The `ADMIN_OPERATOR` branch enforces strict role rules.
- At runtime, `sender.role` can arrive as either:
  - an enum instance, or
  - a raw string form (driver/serialization variability)
- If role normalization is not robust enough, the computed role comparison value does not match:
  - `UserRole.ADMIN.value` or `UserRole.OPERATOR.value`
- That causes the code to fall into the `else:` branch inside the `ADMIN_OPERATOR` block and raise the 403.

Current hardening in `create_message()`:
- `_normalize_user_role()` converts role values into stable `ADMIN` / `OPERATOR` / `MEMBER`
- Permission checks use normalized role consistently.

## 6) Whether the frontend is selecting the wrong conversation
Yes, this was also a realistic contributor because `selectedConversationId` can become stale:
- When the project/conversation list refreshes, the UI may still keep an old `selectedConversationId`.
- If a WS send happens with a conversation id that no longer matches the currently loaded conversation list, backend permission checks can fail.

Current frontend hardening in `frontend/app/admin/dashboard/page.tsx`:
- On send, it resolves `convAtSend` from the latest `conversations` state and errors if missing.
- This prevents sending into a stale conversation id.

Also, to prevent cross-project updates from stale sockets under load:
- `frontend/app/admin/dashboard/page.tsx` now guards WS handlers so messages from an old socket (old `project_id`) do not update the current project’s UI state.
- Additionally, reconnect attempts are limited to avoid reconnect storms when the backend is unhealthy.

## 7) Whether sender.role normalization is failing
This was the core issue in the originally reported runtime:
- Role comparisons in `create_message()` were too sensitive to runtime representation differences.
- The fix is the robust normalization helper and using the normalized value in the `ADMIN_OPERATOR` checks.

## 8) Which files must be changed
For the 403 root-cause fix + prevention:
- `backend/app/main.py`
  - re-fetch conversation on each `"message"`
  - send detailed WS diagnostics
  - pass the prefetched conversation into `create_message()`
- `backend/app/services/conversation_service.py`
  - `_normalize_user_role()` helper
  - use normalized role consistently in `create_message()`
- `frontend/app/admin/dashboard/page.tsx`
  - send-time stale conversation guard
  - ignore WS messages from sockets belonging to a different project

