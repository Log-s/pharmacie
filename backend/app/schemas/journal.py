import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class JournalEntry(BaseModel):
    id: int
    at: datetime
    account_role: str | None  # None = server CLI
    profile_id: uuid.UUID | None
    profile_name: str | None = None  # None when no profile or the profile was deleted
    action: str
    target_type: str | None
    target_id: str | None
    details: dict[str, Any]


class JournalPage(BaseModel):
    items: list[JournalEntry]
    total: int
    page: int
    page_size: int
