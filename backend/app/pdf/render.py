"""Form -> PDF (spec §3.3): Jinja2 template + CSS in this package, rendered by WeasyPrint.
Only the answers visible in the form are printed (same rule as `walk` in the template schema)."""

import uuid
from datetime import date
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import url2pathname
from zoneinfo import ZoneInfo

from jinja2 import Environment, FileSystemLoader
from sqlalchemy import select
from sqlalchemy.orm import Session
from weasyprint import HTML
from weasyprint.urls import URLFetcher

from app.models import Annex, Profile
from app.schemas.forms import FormOut
from app.schemas.template_schema import (
    Category,
    CheckboxGroup,
    Node,
    RadioGroup,
    TemplateTree,
    walk,
)

PDF_DIR = Path(__file__).resolve().parent
# User text is escaped: it can never inject markup (or a remote <img>/@import) into the page.
ENV = Environment(loader=FileSystemLoader(PDF_DIR), autoescape=True)
EMPTY = "—"
PARIS = ZoneInfo("Europe/Paris")
DELETED_ANNEX = "Annexe supprimée"


class LocalFetcher(URLFetcher):
    """Renders offline: only files under app/pdf/ can be fetched (http, https, data: refused)."""

    def fetch(self, url, headers=None):
        parts = urlsplit(url)
        # Decode like urllib's FileHandler will, so %2e%2e cannot slip past the guard.
        path = Path(url2pathname(parts.path))
        if parts.scheme != "file" or parts.netloc or not path.resolve().is_relative_to(PDF_DIR):
            raise ValueError(f"Ressource externe refusée : {url}")
        return super().fetch(url, headers)


def _day(value: str) -> str:
    return date.fromisoformat(value).strftime("%d/%m/%Y")


def _items(nodes: list[Node], data: dict[str, Any], names: dict[str, str], titles: dict[str, str]):
    """Nested dicts for the template: label, annex title, answers [(text, kids)], children."""
    items = []
    for node in nodes:
        value = data.get(str(node.id))
        item: dict[str, Any] = {"label": node.label, "answers": [], "children": []}
        if node.annex_ref:
            item["annex"] = titles.get(str(node.annex_ref.annex_id), DELETED_ANNEX)
        if isinstance(node, Category):
            item["children"] = _items(node.children, data, names, titles)
        elif isinstance(node, RadioGroup | CheckboxGroup):
            chosen = [value] if isinstance(node, RadioGroup) else value or []
            for option in node.options:
                if str(option.id) in chosen:
                    kids = _items(option.children, data, names, titles)
                    item["answers"].append((option.label, kids))
        elif node.type == "date" and value:
            item["answers"] = [(_day(value), [])]
        elif node.type == "author" and value:
            item["answers"] = [(names.get(value, EMPTY), [])]
        elif node.type == "text" and value:
            item["answers"] = [(value, [])]
        if not isinstance(node, Category) and node.type != "reference" and not item["answers"]:
            item["answers"] = [(EMPTY, [])]
        if node.type != "reference":
            items.append(item)
    return items


def render(db: Session, form: FormOut) -> bytes:
    tree = TemplateTree.model_validate(form.tree)
    author_ids = [
        uuid.UUID(form.data[str(n.id)])
        for n in walk(tree.nodes)
        if n.type == "author" and str(n.id) in form.data
    ]
    profiles = db.scalars(select(Profile).where(Profile.id.in_([*author_ids, form.owner.id])))
    names = {str(p.id): _name(p) for p in profiles}
    titles = {
        str(a.id): a.title for a in db.scalars(select(Annex).where(Annex.id.in_(tree.annex_ids())))
    }
    html = ENV.get_template("form.html").render(
        css=(PDF_DIR / "form.css").read_text(encoding="utf-8"),
        form=form,
        author=names[str(form.owner.id)],
        day=form.created_at.astimezone(PARIS).strftime("%d/%m/%Y"),
        items=_items(tree.nodes, form.data, names, titles),
    )
    return HTML(string=html, url_fetcher=LocalFetcher()).write_pdf()


def _name(profile: Profile) -> str:
    return profile.display_name + (" (profil supprimé)" if profile.archived_at else "")
