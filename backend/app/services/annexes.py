"""Annex notes: HTML sanitising and the folder-tree helpers."""

import html
import re
import uuid
from collections import defaultdict
from urllib.parse import quote

import nh3
from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from app.models import AnnexFolder, Template, TemplateVersion

# What the editor can produce (Tiptap StarterKit + underline + link); nothing else survives.
TAGS = set("p h1 h2 h3 strong em u s ul ol li blockquote code pre a br hr".split())
# Block ends and breaks become a space in the plain text, so "<p>a</p><p>b</p>" reads "a b".
BLOCK_END = re.compile(r"</(?:p|h[1-3]|li|blockquote|pre)>|<(?:br|hr)\s*/?>")


def sanitize(raw: str) -> tuple[str, str]:
    """(safe HTML, plain text). Everything outside the allowlist is dropped, <script> and <style>
    with their content, `on*` attributes and non-http(s)/mailto links included."""
    clean = nh3.clean(
        raw,
        tags=TAGS,
        attributes={"a": {"href"}},
        url_schemes={"http", "https", "mailto"},
        link_rel="noopener noreferrer",
        clean_content_tags={"script", "style"},
    )
    text = html.unescape(nh3.clean(BLOCK_END.sub(" ", clean), tags=set()))
    return clean, " ".join(text.split())


def content_disposition(filename: str) -> str:
    """inline header: ASCII fallback plus the RFC 5987 `filename*` with the real name."""
    fallback = re.sub(r'[^\x20-\x7e]|["\\]', "_", filename)
    return f"inline; filename=\"{fallback}\"; filename*=UTF-8''{quote(filename, safe='')}"


def descendants(db: Session, folder_id: uuid.UUID) -> set[uuid.UUID]:
    """Ids of every folder below `folder_id` (not itself). Walks the whole table in Python:
    shortcut: fine for a few hundred folders, use a recursive CTE beyond that."""
    children = defaultdict(list)
    for child_id, parent_id in db.execute(select(AnnexFolder.id, AnnexFolder.parent_id)):
        children[parent_id].append(child_id)
    found: set[uuid.UUID] = set()
    todo = [folder_id]
    while todo:
        for child_id in children[todo.pop()]:
            if child_id not in found:
                found.add(child_id)
                todo.append(child_id)
    return found


def would_cycle(db: Session, folder_id: uuid.UUID, new_parent_id: uuid.UUID | None) -> bool:
    """True when moving the folder under `new_parent_id` (itself or one of its descendants)."""
    return new_parent_id is not None and (
        new_parent_id == folder_id or new_parent_id in descendants(db, folder_id)
    )


def _references(node: object, annex_ids: set[str]) -> bool:
    if isinstance(node, dict):
        ref = node.get("annex_ref")
        if isinstance(ref, dict) and str(ref.get("annex_id", "")).lower() in annex_ids:
            return True
        return any(_references(value, annex_ids) for value in node.values())
    if isinstance(node, list):
        return any(_references(item, annex_ids) for item in node)
    return False


def referencing_templates(db: Session, annex_ids: set[uuid.UUID]) -> list[str]:
    """Names of the templates (archived ones too) whose LATEST version references one of the
    annexes."""
    if not annex_ids:
        return []
    wanted = {str(annex_id) for annex_id in annex_ids}
    other = aliased(TemplateVersion)
    newer = select(func.max(other.version)).where(other.template_id == Template.id)
    rows = db.execute(
        select(Template.name, TemplateVersion.schema_json)
        .join(TemplateVersion, TemplateVersion.template_id == Template.id)
        .where(TemplateVersion.version == newer.scalar_subquery())
    )
    return sorted({name for name, schema in rows if _references(schema, wanted)})
