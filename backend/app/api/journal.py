import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import AfterValidator

from app.api.deps import Db, require_admin
from app.schemas.annexes import no_unstorable
from app.schemas.journal import JournalPage
from app.services import journal

# Mounted under /api in app/main.py; declare full paths below it (e.g. "/journal/...").
# Read-only on purpose: the journal is append-only, nothing here writes to it.
router = APIRouter(tags=["journal"], dependencies=[Depends(require_admin)])


@router.get("/journal")
def list_journal(
    db: Db,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    action: Annotated[str, AfterValidator(no_unstorable)] | None = None,
    profile_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1, le=100_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
) -> JournalPage:
    return journal.list_entries(
        db,
        date_from=date_from,
        date_to=date_to,
        action=action,
        profile_id=profile_id,
        page=page,
        page_size=page_size,
    )


@router.get("/journal/actions")
def list_actions(db: Db) -> list[str]:
    """Distinct action names present in the journal (read from the table, not hard-coded)."""
    return journal.distinct_actions(db)
