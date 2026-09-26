"""
In-memory login rate limiting (per client IP).

Replaces slowapi middleware, which is incompatible with current Starlette
(BaseHTTPMiddleware no longer accepts key_func).
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict

from fastapi import HTTPException, Request, status


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


_WINDOW_SEC = 60.0
_MAX_ATTEMPTS = 10
_lock = threading.Lock()
_attempts: dict[str, list[float]] = defaultdict(list)


def check_login_rate_limit(request: Request) -> None:
    """Raise HTTP 429 if this IP exceeded login attempts in the sliding window."""
    key = _client_ip(request)
    now = time.monotonic()
    with _lock:
        bucket = _attempts[key]
        cutoff = now - _WINDOW_SEC
        while bucket and bucket[0] < cutoff:
            bucket.pop(0)
        if len(bucket) >= _MAX_ATTEMPTS:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Please wait a minute and try again.",
            )
        bucket.append(now)
