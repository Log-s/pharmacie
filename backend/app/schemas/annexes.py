import re
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

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


class AnnexUpload(BaseModel):
    """The non-file field of the upload form."""

    title: Title | None = None


class AnnexOut(BaseModel):
    """Public view: the storage path never leaves the server."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    filename: str
    size: int
    sha256: str
    excerpt: str
    created_at: datetime


class AnnexUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")  # filename, size, sha256 are not editable

    title: Title | None = None
    excerpt: Annotated[str, Field(max_length=2000), AfterValidator(no_unstorable)] | None = None
