import { z } from 'zod'

// Client mirror of backend/app/schemas/template_schema.py (JSON Schema: ./template.schema.json,
// doc: docs/template-schema.md). The server stays the authority; this gives early, French errors.

export type NodeType = 'category' | 'checkbox_group' | 'radio_group' | 'date' | 'author' | 'reference' | 'text'
type NodeBase = { id: string; label: string; required: boolean; help: string | null; annex_ref: { annex_id: string } | null }
export type TemplateOption = { id: string; label: string; children: TemplateNode[] }
export type CategoryNode = NodeBase & { type: 'category'; children: TemplateNode[] }
export type GroupNode = NodeBase & { type: 'checkbox_group' | 'radio_group'; options: TemplateOption[] }
export type TextNode = NodeBase & { type: 'text'; multiline: boolean; max_length: number | null }
export type SimpleNode = NodeBase & { type: 'date' | 'author' | 'reference' }
export type TemplateNode = CategoryNode | GroupNode | TextNode | SimpleNode
export type TemplateTree = { nodes: TemplateNode[] }

export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  category: 'Catégorie',
  checkbox_group: 'Cases à cocher',
  radio_group: 'Choix unique',
  date: 'Date',
  author: 'Auteur',
  reference: 'Référence',
  text: 'Texte',
}

export const isGroup = (node: TemplateNode): node is GroupNode =>
  node.type === 'checkbox_group' || node.type === 'radio_group'

/** Every node depth first; `isOpen(group, option)` decides whether an option's children are visited. */
export function* walk(
  nodes: TemplateNode[],
  isOpen: (group: GroupNode, option: TemplateOption) => boolean = () => true,
): Generator<TemplateNode> {
  for (const node of nodes) {
    yield node
    if (node.type === 'category') yield* walk(node.children, isOpen)
    else if (isGroup(node)) for (const option of node.options) if (isOpen(node, option)) yield* walk(option.children, isOpen)
  }
}

const id = z.guid({ error: 'Identifiant invalide\u00a0: un UUID est attendu.' })
const label = z.string().trim().min(1, 'Le libellé est obligatoire.').max(200, 'Le libellé dépasse 200 caractères.')
const children = z.array(z.lazy(() => templateNode)).default([])
const base = {
  id,
  label,
  required: z.boolean().default(false),
  help: z.string().max(2000, "L'aide dépasse 2000 caractères.").nullable().default(null),
  annex_ref: z.strictObject({ annex_id: id }).nullable().default(null),
}
const option = z.strictObject({
  id,
  label: z.string().trim().min(1, "Le libellé de l'option est obligatoire.").max(200, "Le libellé de l'option dépasse 200 caractères."),
  children,
})
const options = z.array(option).min(1, 'Ajoutez au moins une option.')

export const templateNode: z.ZodType<TemplateNode> = z.discriminatedUnion(
  'type',
  [
    z.strictObject({ ...base, type: z.literal('category'), children }),
    z.strictObject({ ...base, type: z.literal('checkbox_group'), options }),
    z.strictObject({ ...base, type: z.literal('radio_group'), options }),
    z.strictObject({ ...base, type: z.literal('date') }),
    z.strictObject({ ...base, type: z.literal('author') }),
    z.strictObject({ ...base, type: z.literal('reference') }),
    z.strictObject({
      ...base,
      type: z.literal('text'),
      multiline: z.boolean().default(false),
      max_length: z.int().gt(0, 'La longueur maximale doit être supérieure à 0.').nullable().default(null),
    }),
  ],
  { error: 'Type de champ inconnu.' },
)

type Path = (string | number)[]
function* withPaths(nodes: TemplateNode[], path: Path): Generator<[TemplateNode, Path]> {
  for (const [i, node] of nodes.entries()) {
    const here = [...path, i]
    yield [node, here]
    if (node.type === 'category') yield* withPaths(node.children, [...here, 'children'])
    else if (isGroup(node))
      for (const [j, opt] of node.options.entries()) yield* withPaths(opt.children, [...here, 'options', j, 'children'])
  }
}

/** The tree root, with the server's cross-node invariants (unique ids, at most one reference). */
export const templateTree = z.strictObject({ nodes: z.array(templateNode) }).superRefine((tree, ctx) => {
  const seen = new Set<string>()
  let references = 0
  for (const [node, path] of withPaths(tree.nodes, ['nodes'])) {
    if (node.type === 'reference' && ++references > 1)
      ctx.addIssue({ code: 'custom', path, message: 'Un template contient au plus un champ « Référence ».' })
    const ids: [string, Path][] = [[node.id, [...path, 'id']]]
    if (isGroup(node)) node.options.forEach((opt, j) => ids.push([opt.id, [...path, 'options', j, 'id']]))
    for (const [itemId, itemPath] of ids) {
      if (seen.has(itemId)) ctx.addIssue({ code: 'custom', path: itemPath, message: `Identifiant en double\u00a0: ${itemId}.` })
      seen.add(itemId)
    }
  }
})
