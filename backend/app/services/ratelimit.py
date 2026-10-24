"""Sliding-window rate limiter kept in process memory.

shortcut: per-process state, correct with the single uvicorn worker we run; move it to the
database (or Redis) before running several workers or replicas."""

import threading
import time
from collections import defaultdict, deque

WINDOW_SECONDS = 60
_hits: defaultdict[str, deque[float]] = defaultdict(deque)
_lock = threading.Lock()
_last_sweep = 0.0


def allow(key: str, limit: int, window: float = WINDOW_SECONDS) -> bool:
    """Records one hit for `key`; False once `limit` hits fall within the last `window` seconds."""
    global _last_sweep
    now = time.monotonic()
    with _lock:
        if now - _last_sweep >= window:  # at most once per window: forget keys idle that long
            for stale in [k for k, h in _hits.items() if not h or h[-1] <= now - window]:
                del _hits[stale]
            _last_sweep = now
        hits = _hits[key]
        while hits and hits[0] <= now - window:
            hits.popleft()
        if len(hits) >= limit:
            return False
        hits.append(now)
        return True


def reset() -> None:
    global _last_sweep
    with _lock:
        _hits.clear()
        _last_sweep = 0.0
