"""Form `data` against its template version tree (spec §3.2). Only visible value nodes are read:
hidden conditional children and unknown keys are dropped, never validated. Empty values are not
stored (absent key = empty)."""

import uuid
from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from app.models import Profile
from app.schemas.template_schema import Node, Option, TemplateTree, walk


def _selected(value: Any, option: Option) -> bool:
    option_id = str(option.id)
    return value == option_id or (isinstance(value, list) and option_id in value)


def _value(db: Session, node: Node, value: Any) -> Any:
    """The stored form of `value` (None when empty); ValueError with a French message."""
    if value is None:
        return None
    options = [str(o.id) for o in getattr(node, "options", [])]
    match node.type:
        case "text":
            if not isinstance(value, str):
                raise ValueError("texte attendu.")
            if node.max_length is not None and len(value) > node.max_length:
                raise ValueError(f"{node.max_length} caractères au maximum.")
            return value if value.strip() else None
        case "date":
            if value == "":
                return None
            try:
                return date.fromisoformat(value).isoformat()
            except (TypeError, ValueError):
                raise ValueError("date invalide (format AAAA-MM-JJ attendu).") from None
        case "author":
            try:
                profile_id = uuid.UUID(str(value))
            except ValueError:
                profile_id = None
            if profile_id is None or db.get(Profile, profile_id) is None:
                raise ValueError("profil inconnu.")
            return str(profile_id)
        case "radio_group":
            if isinstance(value, list):
                raise ValueError("une seule option possible.")
            if value not in options:
                raise ValueError("option inconnue.")
            return value
        case "checkbox_group":
            if not isinstance(value, list):
                raise ValueError("liste d'options attendue.")
            if any(v not in options for v in value):
                raise ValueError("option inconnue.")
            return [o for o in options if o in value] or None  # template order, no duplicates
    return None  # category, reference: no value in `data`


def clean(db: Session, tree: TemplateTree, data: dict[str, Any]) -> tuple[dict, list[dict]]:
    """(data to store, errors in the 422 `detail[]` format, loc = ["body", "data", node id])."""
    out: dict[str, Any] = {}
    errors: list[dict] = []

    def error(node: Node, message: str) -> None:
        loc = ["body", "data", str(node.id)]
        errors.append({"type": "value_error", "loc": loc, "msg": f"« {node.label} » : {message}"})

    # walk() is lazy: it calls is_open(group, option) after the loop body has handled the group,
    # so `out` already holds the group's validated value and only its selected options open.
    for node in walk(tree.nodes, lambda group, option: _selected(out.get(str(group.id)), option)):
        if node.type in ("category", "reference"):
            continue
        try:
            value = _value(db, node, data.get(str(node.id)))
        except ValueError as exc:
            error(node, str(exc))
            continue
        if value is not None:
            out[str(node.id)] = value
        elif node.required:
            error(node, "champ obligatoire.")
    return out, errors
