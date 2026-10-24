import json
import uuid
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.schemas.template_schema import TemplateTree, json_schema_text, walk

# Repo checkout: <repo>/frontend/...; test image: mount the repo's frontend/ at /frontend.
SCHEMA_FILE = Path(__file__).resolve().parents[2] / "frontend/src/templates/template.schema.json"


def uid() -> str:
    return str(uuid.uuid4())


def full_tree() -> dict:
    """Every node type: nested categories, groups with option children, text variants."""
    return {
        "nodes": [
            {"id": uid(), "type": "reference", "label": "Référence"},
            {"id": uid(), "type": "date", "label": "Date", "required": True},
            {"id": uid(), "type": "author", "label": "Auteur"},
            {
                "id": uid(),
                "type": "category",
                "label": "Contrôle",
                "help": "Partie à remplir au comptoir",
                "children": [
                    {
                        "id": uid(),
                        "type": "category",
                        "label": "Sous-partie",
                        "annex_ref": {"annex_id": uid()},
                        "children": [{"id": uid(), "type": "text", "label": "Note"}],
                    },
                    {
                        "id": uid(),
                        "type": "checkbox_group",
                        "label": "Constats",
                        "options": [
                            {
                                "id": uid(),
                                "label": "Anomalie",
                                "children": [
                                    {
                                        "id": uid(),
                                        "type": "text",
                                        "label": "Détail",
                                        "multiline": True,
                                        "max_length": 500,
                                    }
                                ],
                            },
                            {"id": uid(), "label": "RAS"},
                        ],
                    },
                    {
                        "id": uid(),
                        "type": "radio_group",
                        "label": "Gravité",
                        "options": [
                            {"id": uid(), "label": "Faible"},
                            {
                                "id": uid(),
                                "label": "Forte",
                                "children": [{"id": uid(), "type": "date", "label": "Échéance"}],
                            },
                        ],
                    },
                ],
            },
        ]
    }


def nodes(tree: dict) -> dict:
    """label -> node dict, for targeted mutations."""
    found = {}

    def visit(items):
        for item in items:
            found[item["label"]] = item
            visit(item.get("children", []))
            for option in item.get("options", []):
                found[option["label"]] = option
                visit(option.get("children", []))

    visit(tree["nodes"])
    return found


def test_valid_tree_with_every_node_type_is_accepted():
    data = full_tree()
    tree = TemplateTree.model_validate(data)
    types = {node.type for node in walk(tree.nodes)}
    assert types == {"reference", "date", "author", "category", "checkbox_group", "radio_group",
                     "text"}  # fmt: skip
    detail = next(n for n in walk(tree.nodes) if n.label == "Détail")
    assert (detail.multiline, detail.max_length, detail.required) == (True, 500, False)
    assert tree.annex_ids() == {uuid.UUID(nodes(data)["Sous-partie"]["annex_ref"]["annex_id"])}
    # stored dumps validate back to themselves (restore republishes them unchanged)
    dumped = tree.model_dump(mode="json")
    assert TemplateTree.model_validate(dumped).model_dump(mode="json") == dumped


def test_walk_skips_closed_options():
    tree = TemplateTree.model_validate(full_tree())
    labels = [n.label for n in walk(tree.nodes, lambda _group, option: option.label == "Forte")]
    assert "Échéance" in labels and "Détail" not in labels
    assert "Détail" in [n.label for n in walk(tree.nodes)]


def mutate_duplicate_id(tree):
    found = nodes(tree)
    found["Échéance"]["id"] = found["Note"]["id"]


def mutate_duplicate_option_id(tree):
    found = nodes(tree)
    found["RAS"]["id"] = found["Date"]["id"]


def mutate_two_references(tree):
    nodes(tree)["Sous-partie"]["children"].append(
        {"id": uid(), "type": "reference", "label": "Autre référence"}
    )


def mutate_empty_option_label(tree):
    nodes(tree)["RAS"]["label"] = "   "


def mutate_unknown_type(tree):
    nodes(tree)["Note"]["type"] = "signature"


def mutate_bad_id(tree):
    nodes(tree)["Note"]["id"] = "note-1"


def mutate_zero_max_length(tree):
    nodes(tree)["Détail"]["max_length"] = 0


def mutate_negative_max_length(tree):
    nodes(tree)["Détail"]["max_length"] = -5


def mutate_children_on_group(tree):
    nodes(tree)["Constats"]["children"] = [{"id": uid(), "type": "date", "label": "Hors option"}]


def mutate_children_on_leaf(tree):
    nodes(tree)["Note"]["children"] = []


def mutate_group_without_options(tree):
    nodes(tree)["Gravité"]["options"] = []


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (mutate_duplicate_id, "Identifiant en double"),
        (mutate_duplicate_option_id, "Identifiant en double"),
        (mutate_two_references, "au plus un champ « reference »"),
        (mutate_empty_option_label, "at least 1 character"),
        (mutate_unknown_type, "does not match any of the expected tags"),
        (mutate_bad_id, "valid UUID"),
        (mutate_zero_max_length, "greater than 0"),
        (mutate_negative_max_length, "greater than 0"),
        (mutate_children_on_group, "Extra inputs are not permitted"),
        (mutate_children_on_leaf, "Extra inputs are not permitted"),
        (mutate_group_without_options, "at least 1 item"),
    ],
)
def test_invalid_tree_is_rejected(mutate, message):
    data = full_tree()
    mutate(data)
    with pytest.raises(ValidationError) as error:
        TemplateTree.model_validate(data)
    assert message in str(error.value)


def test_duplicate_error_names_the_id():
    data = full_tree()
    mutate_duplicate_id(data)
    with pytest.raises(ValidationError, match=nodes(data)["Note"]["id"]):
        TemplateTree.model_validate(data)


@pytest.mark.skipif(not SCHEMA_FILE.exists(), reason=f"{SCHEMA_FILE} not mounted")
def test_committed_json_schema_is_up_to_date():
    """Regenerate: see docs/template-schema.md (python -m app.schemas.template_schema)."""
    assert json.loads(json_schema_text())["required"] == ["nodes"]
    assert SCHEMA_FILE.read_text(encoding="utf-8") == json_schema_text()
