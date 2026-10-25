"""Annex folder subtree -> PDF (spec §Export PDF): the chosen node is the h1, deeper folders and
note titles get deeper headings (capped at h6), note bodies are already sanitised by nh3."""

import re
import uuid
from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from weasyprint import HTML

from app.models import Annex, AnnexFolder
from app.pdf.render import ENV, PDF_DIR, LocalFetcher

ROOT_TITLE = "Annexes"
HEADING = re.compile(r"<(/?)h([1-6])>")


def _shift(body_html: str, by: int) -> str:
    return HEADING.sub(lambda m: f"<{m[1]}h{min(int(m[2]) + by, 6)}>", body_html)


def render(db: Session, folder: AnnexFolder | None) -> bytes:
    """`folder` None = the whole tree."""
    sub = defaultdict(list)
    for f in db.scalars(select(AnnexFolder)):
        sub[f.parent_id].append(f)
    notes = defaultdict(list)
    for n in db.scalars(select(Annex)):
        notes[n.folder_id].append(n)

    def build(folder_id: uuid.UUID | None, level: int) -> list[dict[str, Any]]:
        """Notes of the folder, then of its sub-folders; a sub-tree without any note yields []."""
        items: list[dict[str, Any]] = []
        for child in sorted(sub[folder_id], key=lambda f: f.name.casefold()):
            if inner := build(child.id, min(level + 1, 6)):
                items += [{"level": min(level + 1, 6), "title": child.name, "html": ""}, *inner]
        for note in sorted(notes[folder_id], key=lambda n: n.title.casefold()):
            title_level = min(level + 1, 6)
            items.append(
                {
                    "level": title_level,
                    "title": note.title,
                    "html": _shift(note.body_html, title_level),
                }
            )
        return items

    folder_id = folder.id if folder else None
    title = folder.name if folder else ROOT_TITLE
    html = ENV.get_template("annexes.html").render(
        css=(PDF_DIR / "annexes.css").read_text(encoding="utf-8"),
        title=title,
        items=build(folder_id, 1),
    )
    return HTML(string=html, url_fetcher=LocalFetcher()).write_pdf()
