import { describe, expect, test } from 'vitest'
import jsonSchema from '@/templates/template.schema.json'
import { templateTree } from '@/templates/schema'

// Tiny validator for the subset of JSON Schema that Pydantic emits in template.schema.json.
type Schema = Record<string, unknown>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const root = jsonSchema as Schema

function typeOk(type: string, value: unknown): boolean {
  if (type === 'null') return value === null
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value)
  if (type === 'integer') return Number.isInteger(value)
  return typeof value === type
}

function valid(schema: Schema, value: unknown): boolean {
  if (typeof schema.$ref === 'string') {
    const name = schema.$ref.replace('#/$defs/', '')
    return valid((root.$defs as Record<string, Schema>)[name], value)
  }
  if (schema.oneOf) return (schema.oneOf as Schema[]).filter((s) => valid(s, value)).length === 1
  if (schema.anyOf) return (schema.anyOf as Schema[]).some((s) => valid(s, value))
  if ('const' in schema && value !== schema.const) return false
  if (typeof schema.type === 'string' && !typeOk(schema.type, value)) return false
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) return false
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) return false
    if (schema.format === 'uuid' && !UUID.test(value)) return false
  }
  if (typeof value === 'number' && typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) return false
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) return false
    if (schema.items && !value.every((item) => valid(schema.items as Schema, item))) return false
  }
  if (schema.type === 'object') {
    const object = value as Record<string, unknown>
    const properties = (schema.properties ?? {}) as Record<string, Schema>
    if (!((schema.required ?? []) as string[]).every((key) => key in object)) return false
    if (schema.additionalProperties === false && Object.keys(object).some((key) => !(key in properties))) return false
    return Object.entries(object).every(([key, item]) => !properties[key] || valid(properties[key], item))
  }
  return true
}

// Rules the JSON Schema cannot express, enforced by TemplateTree's validators (template_schema.py):
// labels are stripped before the length check, ids are unique, at most one reference node.
function serverOnlyRulesOk(tree: { nodes: Node[] }): boolean {
  const ids: string[] = []
  let references = 0
  let labelsOk = true
  const visit = (nodes: Node[]) => {
    for (const node of nodes) {
      ids.push(node.id)
      references += Number(node.type === 'reference')
      labelsOk &&= node.label.trim().length > 0
      for (const option of node.options ?? []) {
        ids.push(option.id)
        labelsOk &&= option.label.trim().length > 0
        visit(option.children ?? [])
      }
      visit(node.children ?? [])
    }
  }
  visit(tree.nodes)
  return labelsOk && references <= 1 && new Set(ids).size === ids.length
}
type Node = {
  id: string
  type: string
  label: string
  options?: { id: string; label: string; children?: Node[] }[]
  children?: Node[]
  [key: string]: unknown
}

const serverAccepts = (tree: unknown) => valid(root, tree) && serverOnlyRulesOk(tree as { nodes: Node[] })
const zodAccepts = (tree: unknown) => templateTree.safeParse(tree).success

const u = (n: number) => `6f1c0e0a-1b7e-4c55-9a51-0c6a3e1f${String(n).padStart(4, '0')}`
const everyType = (): { nodes: Node[] } => ({
  nodes: [
    { id: u(1), type: 'reference', label: 'Référence' },
    { id: u(2), type: 'date', label: 'Date', required: true },
    { id: u(3), type: 'author', label: 'Auteur', help: null, annex_ref: null },
    {
      id: u(4),
      type: 'category',
      label: 'Contrôle',
      children: [
        {
          id: u(5),
          type: 'radio_group',
          label: 'Résultat',
          required: true,
          annex_ref: { annex_id: '0d9b3f52-55a4-4d0e-9f0e-3b1c2a7d0001' },
          options: [
            { id: u(6), label: 'Conforme' },
            { id: u(7), label: 'Non conforme', children: [{ id: u(8), type: 'text', label: 'Écart', multiline: true, max_length: 1000 }] },
          ],
        },
        { id: u(9), type: 'checkbox_group', label: 'Vérifications', help: 'Cochez ce qui a été fait.', options: [{ id: u(10), label: 'Étiquette', children: [] }] },
        { id: u(11), type: 'category', label: 'Vide' },
      ],
    },
    { id: u(12), type: 'text', label: 'Commentaire' },
  ],
})

// Each case mutates a valid tree; `accepted` is the server's verdict (Pydantic + JSON Schema).
const cases: [string, (t: { nodes: Node[] }) => unknown, boolean][] = [
  ['valid tree with every node type', (t) => t, true],
  ['empty tree', () => ({ nodes: [] }), true],
  ['duplicate id (node and option)', (t) => ((t.nodes[4].id = u(6)), t), false],
  ['two reference nodes', (t) => (t.nodes.push({ id: u(13), type: 'reference', label: 'Autre' }), t), false],
  ['empty option label', (t) => ((t.nodes[3].children![0].options![0].label = ''), t), false],
  ['blank option label (stripped)', (t) => ((t.nodes[3].children![0].options![0].label = '   '), t), false],
  ['unknown type', (t) => ((t.nodes[1].type = 'signature'), t), false],
  ['non-UUID id', (t) => ((t.nodes[1].id = 'node-2'), t), false],
  ['max_length 0', (t) => ((t.nodes[3].children![0].options![1].children![0].max_length = 0), t), false],
  ['max_length negative', (t) => ((t.nodes[3].children![0].options![1].children![0].max_length = -5), t), false],
  ['unknown key on a node', (t) => (Object.assign(t.nodes[1], { placeholder: 'x' }), t), false],
  ['children on a leaf node', (t) => (Object.assign(t.nodes[1], { children: [] }), t), false],
  ['group without options', (t) => ((t.nodes[3].children![1].options = []), t), false],
  ['label over 200 characters', (t) => ((t.nodes[0].label = 'x'.repeat(201)), t), false],
  ['missing nodes key', () => ({}), false],
  ['annex_ref with a bad id', (t) => ((t.nodes[3].children![0].annex_ref = { annex_id: 'x' }), t), false],
]

describe('zod schema <-> template.schema.json parity', () => {
  test.each(cases)('%s', (_name, mutate, accepted) => {
    const tree = mutate(everyType())
    expect(serverAccepts(tree)).toBe(accepted)
    expect(zodAccepts(tree)).toBe(accepted)
  })

  test('zod output writes the defaults out, like the stored dump', () => {
    const parsed = templateTree.parse({ nodes: [{ id: u(1), type: 'text', label: '  Note ' }] })
    expect(parsed.nodes[0]).toEqual({ id: u(1), type: 'text', label: 'Note', required: false, help: null, annex_ref: null, multiline: false, max_length: null })
  })

  test('invariant errors point at the offending node', () => {
    const tree = everyType()
    tree.nodes.push({ id: u(13), type: 'reference', label: 'Autre' })
    const result = templateTree.safeParse(tree)
    expect(result.error?.issues.map((i) => [i.path, i.message])).toEqual([[['nodes', 5], 'Un template contient au plus un champ « Référence ».']])
  })
})
