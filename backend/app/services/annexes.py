"""Annex PDF storage. The on-disk name is `<annex uuid>.pdf` in settings.annexes_dir, never
anything the client sent; the client's filename is metadata only."""

import hashlib
import re
import uuid
from pathlib import Path
from typing import BinaryIO
from urllib.parse import quote

from fastapi import HTTPException
from pypdf import PdfReader
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.models import Annex, Template, TemplateVersion
from app.settings import settings

EXCERPT_CHARS = 500
EXCERPT_MAX_PAGES = 20  # bounds the pypdf work on huge documents
CHUNK = 64 * 1024
CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")  # C0 except \t \n \r
MULTIPART_OVERHEAD = 1024 * 1024  # boundaries, headers and the title field around the file


def too_big_message() -> str:
    return f"Fichier trop volumineux (maximum {settings.annex_max_bytes // (1024 * 1024)} Mo)."


def clean_filename(raw: str | None) -> str:
    """Last path component, no control characters, at most 255 chars (keeping the extension)."""
    last = re.split(r"[\\/]", raw or "")[-1]
    last = last.encode("utf-8", "ignore").decode()  # drops lone surrogates
    name = re.sub(r"[\x00-\x1f\x7f]", "", last).strip()
    return name if len(name) <= 255 else name[:251] + name[-4:]


def content_disposition(filename: str) -> str:
    """inline header: ASCII fallback plus the RFC 5987 `filename*` with the real name."""
    fallback = re.sub(r'[^\x20-\x7e]|["\\]', "_", filename)
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


def path_for(annex_id: uuid.UUID) -> Path:
    return settings.annexes_dir / f"{annex_id}.pdf"


def path_of(annex: Annex) -> Path:
    return settings.annexes_dir / annex.storage_path


def extract_excerpt(path: Path) -> str:
    """First ~500 characters of text, whitespace-normalised; "" when there is none or the
    file is one pypdf cannot read (encrypted, damaged): the upload stays valid."""
    try:
        parts: list[str] = []
        with path.open("rb") as handle:
            for page in PdfReader(handle).pages[:EXCERPT_MAX_PAGES]:
                parts.append(page.extract_text() or "")
                if sum(map(len, parts)) >= EXCERPT_CHARS * 2:
                    break
    except Exception:  # noqa: BLE001  # pypdf raises many types on bad input
        return ""
    return storable_excerpt(" ".join(parts))


def storable_excerpt(raw: str) -> str:
    """Whitespace-normalised, cut to EXCERPT_CHARS, and always storable: NUL and the other C0
    controls would fail the INSERT, a lone surrogate would fail the UTF-8 encoding."""
    text = CONTROL_CHARS.sub("", raw.encode("utf-8", "ignore").decode())
    return " ".join(text.split())[:EXCERPT_CHARS]


def store_pdf(source: BinaryIO, filename: str | None) -> tuple[uuid.UUID, str, int, str]:
    """Validates and writes the upload. Returns (id, clean filename, size, sha256).
    422 unless the name ends in .pdf AND the content starts with `%PDF-`; 413 above the limit."""
    name = clean_filename(filename)
    if not name.lower().endswith(".pdf"):
        raise HTTPException(422, "Le fichier doit avoir l'extension .pdf.")
    head = source.read(5)
    if head != b"%PDF-":
        raise HTTPException(422, "Le fichier n'est pas un PDF valide.")
    annex_id = uuid.uuid4()
    limit = settings.annex_max_bytes
    digest, size = hashlib.sha256(head), len(head)
    settings.annexes_dir.mkdir(parents=True, exist_ok=True)
    path = path_for(annex_id)
    try:
        with path.open("xb") as out:
            out.write(head)
            while chunk := source.read(CHUNK):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, too_big_message())
                digest.update(chunk)
                out.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return annex_id, name, size, digest.hexdigest()


def _references(node: object, annex_id: str) -> bool:
    if isinstance(node, dict):
        ref = node.get("annex_ref")
        if isinstance(ref, dict) and str(ref.get("annex_id", "")).lower() == annex_id:
            return True
        return any(_references(value, annex_id) for value in node.values())
    if isinstance(node, list):
        return any(_references(item, annex_id) for item in node)
    return False


def referencing_templates(db: Session, annex_id: uuid.UUID) -> list[str]:
    """Names of the templates (archived ones too) whose LATEST version references the annex."""
    other = aliased(TemplateVersion)
    newer = select(func.max(other.version)).where(other.template_id == Template.id)
    rows = db.execute(
        select(Template.name, TemplateVersion.schema_json)
        .join(TemplateVersion, TemplateVersion.template_id == Template.id)
        .where(TemplateVersion.version == newer.scalar_subquery())
    )
    return sorted({name for name, schema in rows if _references(schema, str(annex_id))})
