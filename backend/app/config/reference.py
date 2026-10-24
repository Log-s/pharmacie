"""Form reference format (spec §3.2). Provisional: FIXME-\\d{6}. Change it here and only here.

Mirrored on the client in frontend/src/config/reference.ts.
"""

import re

REFERENCE_PREFIX = "FIXME"
REFERENCE_DIGITS = 6
REFERENCE_PATTERN = rf"{REFERENCE_PREFIX}-[0-9]{{{REFERENCE_DIGITS}}}"
REFERENCE_RE = re.compile(REFERENCE_PATTERN)


def format_reference(number: int) -> str:
    return f"{REFERENCE_PREFIX}-{number:0{REFERENCE_DIGITS}d}"


def is_valid_reference(value: str) -> bool:
    return REFERENCE_RE.fullmatch(value) is not None
