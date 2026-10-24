"""Sliding-window rate limiter kept in process memory.

shortcut: per-process state, correct with the single uvicorn worker we run; move it to the
database (or Redis) before running several workers or replicas."""

import threading
import time
from collections import defaultdict, deque

WINDOW_SECONDS = 60
_hits: defaultdict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()


def allow(key: str, limit: int, window: float = WINDOW_SECONDS) -> bool:
    """Records one hit for `key`; False once `limit` hits fall within the last `window` seconds."""
    now = time.monotonic()
    with _lock:
        hits = _hits[key]
        while hits and hits[0] <= now - window:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True


def reset() -> None:
    with _lock:
        _hits.clear()
