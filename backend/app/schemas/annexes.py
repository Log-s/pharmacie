import re
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

UNSTORABLE = re.compile("[\x00\ud800-\udfff]")


def no_unstorable(value: str) -> str:
    # PostgreSQL text cannot hold NUL and UTF-8 cannot encode a lone surrogate: refuse both up
    # front (422) instead of failing at INSERT time or in the search with a 500.
    if UNSTORABLE.search(value):
        raise ValueError("Le texte ne peut pas contenir de caractère nul ou invalide.")
    return value


Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    AfterValidator(no_unstorable),
]


Html = Annotated[str, StringConstraints(max_length=200_000), AfterValidator(no_unstorable)]


class NoteIn(BaseModel):
    title: Title
    body_html: Html = ""  # sanitised server-side on every write
    folder_id: uuid.UUID | None = None  # null = root


class NoteUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: Title | None = None
    body_html: Html | None = None
    folder_id: uuid.UUID | None = None  # sent as null = move to the root


class NoteSummary(BaseModel):
    """What the tree and the search list: no body."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    folder_id: uuid.UUID | None
    excerpt: str
    updated_at: datetime


class NoteOut(NoteSummary):
    body_html: str
    created_at: datetime


class FolderIn(BaseModel):
    name: Title
    parent_id: uuid.UUID | None = None


class FolderUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Title | None = None
    parent_id: uuid.UUID | None = None  # sent as null = move to the root


class FolderOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    parent_id: uuid.UUID | None


class TreeOut(BaseModel):
    folders: list[FolderOut]
    notes: list[NoteSummary]
