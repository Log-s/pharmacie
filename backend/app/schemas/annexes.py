import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


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
    excerpt: Annotated[str, Field(max_length=2000)] | None = None
