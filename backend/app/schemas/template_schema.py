"""The template tree (spec §3.2): a Pydantic v2 discriminated union on `type`, stored as
`template_versions.schema_json`. Doc: docs/template-schema.md. The JSON Schema export
(`python -m app.schemas.template_schema`) is the contract the front's zod schema mirrors."""

import json
import uuid
from collections.abc import Callable, Iterator
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

from app.schemas.annexes import no_unstorable

Label = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    AfterValidator(no_unstorable),
]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")  # a typo'd key is an error, not silently dropped


class AnnexRef(Strict):
    annex_id: uuid.UUID  # U6 scans schema_json for this exact key path


class NodeBase(Strict):
    id: uuid.UUID
    label: Label
    required: bool = False
    help: Annotated[str, Field(max_length=2000), AfterValidator(no_unstorable)] | None = None
    annex_ref: AnnexRef | None = None


class Option(Strict):
    id: uuid.UUID
    label: Label
    children: list["Node"] = []  # shown (and validated) only while the option is selected


class Category(NodeBase):
    type: Literal["category"]
    children: list["Node"] = []


class CheckboxGroup(NodeBase):
    type: Literal["checkbox_group"]
    options: list[Option] = Field(min_length=1)


class RadioGroup(NodeBase):
    type: Literal["radio_group"]
    options: list[Option] = Field(min_length=1)


class DateField(NodeBase):
    type: Literal["date"]


class AuthorField(NodeBase):
    type: Literal["author"]


class ReferenceField(NodeBase):
    type: Literal["reference"]


class TextField(NodeBase):
    type: Literal["text"]
    multiline: bool = False
    max_length: int | None = Field(default=None, gt=0)


Node = Annotated[
    Category | CheckboxGroup | RadioGroup | DateField | AuthorField | ReferenceField | TextField,
    Field(discriminator="type"),
]
Group = CheckboxGroup | RadioGroup


def walk(
    nodes: list[Node], is_open: Callable[[Group, Option], bool] = lambda _group, _option: True
) -> Iterator[Node]:
    """Every node, depth first. `is_open(group, option)` decides whether an option's children are
    visited: pass "is this option selected in the form data" to get the visible nodes only."""
    for node in nodes:
        yield node
        if isinstance(node, Category):
            yield from walk(node.children, is_open)
        elif isinstance(node, Group):
            for option in node.options:
                if is_open(node, option):
                    yield from walk(option.children, is_open)


class TemplateTree(Strict):
    """Root of `schema_json`: `{"nodes": [...]}`."""

    nodes: list[Node]

    @model_validator(mode="after")
    def check_invariants(self) -> "TemplateTree":
        seen: set[uuid.UUID] = set()
        references = 0
        for node in walk(self.nodes):
            references += node.type == "reference"
            for item_id in [node.id, *(o.id for o in getattr(node, "options", []))]:
                if item_id in seen:
                    raise ValueError(f"Identifiant en double dans le template : {item_id}")
                seen.add(item_id)
        if references > 1:
            raise ValueError("Un template contient au plus un champ « reference ».")
        return self

    def annex_ids(self) -> set[uuid.UUID]:
        return {node.annex_ref.annex_id for node in walk(self.nodes) if node.annex_ref}


def json_schema_text() -> str:
    """Content of frontend/src/templates/template.schema.json (a test keeps them equal)."""
    return json.dumps(TemplateTree.model_json_schema(), indent=2, ensure_ascii=False) + "\n"


if __name__ == "__main__":
    print(json_schema_text(), end="")
