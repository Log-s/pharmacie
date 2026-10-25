"""Form reference format (spec §3.2): MM-YYYY-NNN, the sequence restarting at 001 each month
(Europe/Paris). Change the format here and only here.

NNN is 3 zero-padded digits, or 4+ digits without a leading zero past 999.
Mirrored on the client in frontend/src/config/reference.ts.
"""

import re
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

PARIS = ZoneInfo("Europe/Paris")
REFERENCE_HINT = "MM-AAAA-NNN"
REFERENCE_PATTERN = r"(0[1-9]|1[0-2])-[0-9]{4}-([0-9]{3}|[1-9][0-9]{3,})"
REFERENCE_RE = re.compile(REFERENCE_PATTERN)


def current_period(now: datetime | None = None) -> str:
    """Counter key and reference prefix: the month of `now` (default: now) in Paris, `MM-YYYY`."""
    return (now or datetime.now(UTC)).astimezone(PARIS).strftime("%m-%Y")


def format_reference(period: str, number: int) -> str:
    return f"{period}-{number:03d}"


def reference_example(now: datetime | None = None) -> str:
    return format_reference(current_period(now), 42)


def is_valid_reference(value: str) -> bool:
    return REFERENCE_RE.fullmatch(value) is not None
