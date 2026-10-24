"""Shared helpers for the test_forms_* modules (no tests here). Templates are inserted with the
models directly: the templates API is U5's and is tested there."""

import json
import uuid

from sqlalchemy import func, select

from app.models import ActivityLog, Template, TemplateVersion
from app.schemas.template_schema import TemplateTree


def uid() -> str:
    return str(uuid.uuid4())


REF, DATE, AUTHOR, CAT, TITLE, RESULT, OK, KO, COMMENT, CHECKS, CA, CB, WHEN = (
    uid() for _ in range(13)
)
NODES = [
    {"id": REF, "type": "reference", "label": "Référence"},
    {"id": DATE, "type": "date", "label": "Date", "required": True},
    {"id": AUTHOR, "type": "author", "label": "Auteur"},
    {
        "id": CAT,
        "type": "category",
        "label": "Contrôle",
        "children": [
            {"id": TITLE, "type": "text", "label": "Titre", "required": True, "max_length": 10},
            {
                "id": RESULT,
                "type": "radio_group",
                "label": "Résultat",
                "options": [
                    {"id": OK, "label": "Conforme"},
                    {
                        "id": KO,
                        "label": "Non conforme",
                        "children": [
                            {"id": COMMENT, "type": "text", "label": "Écart", "required": True}
                        ],
                    },
                ],
            },
            {
                "id": CHECKS,
                "type": "checkbox_group",
                "label": "Vérifications",
                "options": [
                    {"id": CA, "label": "Étiquette"},
                    {
                        "id": CB,
                        "label": "Péremption",
                        "children": [{"id": WHEN, "type": "date", "label": "Date de péremption"}],
                    },
                ],
            },
        ],
    },
]


def valid_data(**overrides) -> dict:
    return {DATE: "2026-10-24", TITLE: "Lot 1"} | overrides


def publish(db, nodes=None, template: Template | None = None, name="Contrôle") -> TemplateVersion:
    """Version n+1 of `template` (a new template when None)."""
    if template is None:
        template = Template(name=name)
        db.add(template)
        db.flush()
    latest = select(func.max(TemplateVersion.version)).where(
        TemplateVersion.template_id == template.id
    )
    tree = TemplateTree.model_validate({"nodes": NODES if nodes is None else nodes})
    version = TemplateVersion(
        template_id=template.id,
        version=(db.scalar(latest) or 0) + 1,
        schema_json=tree.model_dump(mode="json"),
    )
    db.add(version)
    db.commit()
    return version


def create(client, version: TemplateVersion, data=None, reference=None):
    body = {"template_version_id": str(version.id), "data": valid_data() if data is None else data}
    if reference is not None:
        body["reference"] = reference
    return client.post("/api/forms", json=body)


def created(client, version: TemplateVersion, data=None, reference=None) -> dict:
    response = create(client, version, data, reference)
    assert response.status_code == 201, response.text
    return response.json()


def update(client, form: dict, data=None, reference=None):
    body = {"reference": reference or form["reference"], "data": data or valid_data()}
    return client.put(f"/api/forms/{form['id']}", json=body)


def journal(db) -> list[ActivityLog]:
    db.expire_all()
    return list(db.scalars(select(ActivityLog).order_by(ActivityLog.id)))


def raw(client, method: str, url: str, body: dict):
    """JSON sent with \\u escapes: httpx's json= cannot encode a lone surrogate."""
    headers = {"content-type": "application/json"}
    return client.request(method, url, content=json.dumps(body), headers=headers)
