import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints


def _no_nul(value: str) -> str:
    # PostgreSQL text columns cannot store NUL: refuse it up front instead of failing with a 500.
    if "\x00" in value:
        raise ValueError("Le texte ne peut pas contenir de caractère nul.")
    return value


Title = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    AfterValidator(_no_nul),
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
    excerpt: Annotated[str, Field(max_length=2000), AfterValidator(_no_nul)] | None = None
