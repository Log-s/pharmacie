# Template schema

A template version stores one tree in `template_versions.schema_json`. The Pydantic model
`backend/app/schemas/template_schema.py::TemplateTree` is the source of truth; the server validates
every publish with it. The front mirrors it in zod from the generated JSON Schema
`frontend/src/templates/template.schema.json`.

## Root

```json
{ "nodes": [ <node>, ... ] }
```

Unknown keys are rejected everywhere (root, nodes, options, `annex_ref`).

## Common node attributes

| Key | Type | Default | Notes |
|---|---|---|---|
| `id` | UUID string | required | stable across versions; form data is keyed by it |
| `type` | string | required | discriminator, one of the types below |
| `label` | string | required | trimmed, 1 to 200 characters |
| `required` | bool | `false` | |
| `help` | string or null | `null` | at most 2000 characters |
| `annex_ref` | `{"annex_id": UUID}` or null | `null` | the annex must exist at publish time |

The stored tree is the validated dump, so every default is written out explicitly.

## Node types

| `type` | Extra keys | Behavior |
|---|---|---|
| `category` | `children: [node]` (default `[]`) | named group; categories nest |
| `checkbox_group` | `options: [option]` (at least 1) | several options can be checked |
| `radio_group` | `options: [option]` (at least 1) | one option at most |
| `date` | none | prefilled with today, editable |
| `author` | none | prefilled with the active profile, editable (a profile id) |
| `reference` | none | the form's reference (`forms.reference`, format in `app/config/reference.py`) |
| `text` | `multiline: bool` (default `false`), `max_length: int > 0` or null (default `null`, unbounded) | |

An **option** is `{"id": UUID, "label": string (trimmed, non-empty), "children": [node]}`
(`children` defaults to `[]`). An option's children are shown, validated and stored only while the
option is selected.

## Invariants

- Every `id` is unique across the whole tree, nodes and options together.
- At most one `reference` node per template: a form has exactly one reference
  (`forms.reference`), so a second field could only duplicate it. Zero is allowed.
- Option labels (and node labels) are non-empty after trimming. The JSON Schema says
  `minLength: 1`; trimming is a server rule the zod schema should mirror (`.trim().min(1)`).
- Children only where the type allows them: `category.children` and `option.children`.
  A `children` key on a group or a leaf node is an unknown key, so it is rejected.
- `text.max_length`, when set, is greater than 0.
- Publishing (and restoring) checks every `annex_ref.annex_id` against the `annexes` table:
  422 listing the missing ids otherwise.

## Example

```json
{
  "nodes": [
    {"id": "6f1c0e0a-1b7e-4c55-9a51-0c6a3e1f0001", "type": "reference", "label": "Référence"},
    {"id": "6f1c0e0a-1b7e-4c55-9a51-0c6a3e1f0002", "type": "date", "label": "Date", "required": true},
    {"id": "6f1c0e0a-1b7e-4c55-9a51-0c6a3e1f0003", "type": "author", "label": "Auteur"},
    {
      "id": "6f1c0e0a-1b7e-4c55-9a51-0c6a3e1f0004", "type": "category", "label": "Contrôle",
      "children": [
        {
          "id": "6f1c0e0a-1b7e-4c55-9a51-0c6a3e1f0005", "type": "radio_group", "label": "Résultat",
          "required": true,
          "annex_ref": {"annex_id": "0d9b3f52-55a4-4d0e-9f0e-3b1c2a7d0001"},
          "options": [
            {"id": "6f1c0e0a-1b7e-4c55-9a51-0c6a3e1f0006", "label": "Conforme"},
            {
              "id": "6f1c0e0a-1b7e-4c55-9a51-0c6a3e1f0007", "label": "Non conforme",
              "children": [
                {
                  "id": "6f1c0e0a-1b7e-4c55-9a51-0c6a3e1f0008", "type": "text",
                  "label": "Description de l'écart", "multiline": true, "max_length": 1000
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

## Walking the tree (server)

`template_schema.walk(nodes, is_open=...)` yields every node depth first. `is_open(group, option)`
decides whether an option's children are visited; pass "this option is selected in the form data"
to get only the visible nodes (what form validation and the PDF use). `TemplateTree.annex_ids()`
returns the referenced annex ids.

## Regenerating `template.schema.json`

The backend test `tests/test_templates_schema.py::test_committed_json_schema_is_up_to_date`
compares the committed file with the model's export. It needs the repo's `frontend/` mounted at
`/frontend` in the test container (it is skipped otherwise). After changing the model:

```sh
scripts/test-backend.sh python -m app.schemas.template_schema \
  > frontend/src/templates/template.schema.json
```
