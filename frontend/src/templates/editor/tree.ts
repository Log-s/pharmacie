import { isGroup, walk, type NodeType, type TemplateNode, type TemplateOption, type TemplateTree } from '@/templates/schema'

// Immutable edits of a template tree. A container is where nodes live: the root, a category, or
// an option (its conditional children); it is named by that category's or option's id.
export const ROOT = 'root'

const NEW_LABELS: Record<NodeType, string> = {
  category: 'Nouvelle catégorie',
  checkbox_group: 'Nouvelle liste de cases',
  radio_group: 'Nouveau choix unique',
  date: 'Date',
  author: 'Auteur',
  reference: 'Référence',
  text: 'Nouveau texte',
}

export const newOption = (label: string): TemplateOption => ({ id: crypto.randomUUID(), label, children: [] })

export function newNode(type: NodeType): TemplateNode {
  const base = { id: crypto.randomUUID(), label: NEW_LABELS[type], required: false, help: null, annex_ref: null }
  if (type === 'category') return { ...base, type, children: [] }
  if (type === 'checkbox_group' || type === 'radio_group') return { ...base, type, options: [newOption('Option 1'), newOption('Option 2')] }
  if (type === 'text') return { ...base, type, multiline: false, max_length: null }
  return { ...base, type }
}

/** Rebuilds the tree bottom-up; `fn` may rewrite each container's node list. */
function mapContainers(tree: TemplateTree, fn: (container: string, nodes: TemplateNode[]) => TemplateNode[]): TemplateTree {
  const visitNode = (node: TemplateNode): TemplateNode => {
    if (node.type === 'category') return { ...node, children: visit(node.id, node.children) }
    if (isGroup(node)) return { ...node, options: node.options.map((o) => ({ ...o, children: visit(o.id, o.children) })) }
    return node
  }
  const visit = (container: string, nodes: TemplateNode[]) => fn(container, nodes.map(visitNode))
  return { nodes: visit(ROOT, tree.nodes) }
}

export const findNode = (tree: TemplateTree, id: string) => [...walk(tree.nodes)].find((n) => n.id === id)

export function updateNode(tree: TemplateTree, id: string, patch: Partial<TemplateNode>): TemplateTree {
  return mapContainers(tree, (_c, nodes) => nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as TemplateNode) : n)))
}

export function removeNode(tree: TemplateTree, id: string): TemplateTree {
  return mapContainers(tree, (_c, nodes) => nodes.filter((n) => n.id !== id))
}

export function insertNode(tree: TemplateTree, node: TemplateNode, container: string, index = Infinity): TemplateTree {
  return mapContainers(tree, (c, nodes) => (c === container ? [...nodes.slice(0, index), node, ...nodes.slice(index)] : nodes))
}

/** Where a node lives: its container and its index there. */
export function locate(tree: TemplateTree, id: string): { container: string; index: number } | null {
  let found: { container: string; index: number } | null = null
  mapContainers(tree, (container, nodes) => {
    const index = nodes.findIndex((n) => n.id === id)
    if (index >= 0) found = { container, index }
    return nodes
  })
  return found
}

/** Ids of a node, its options and everything below it. */
export function subtreeIds(node: TemplateNode): Set<string> {
  const ids = new Set<string>()
  for (const n of walk([node])) {
    ids.add(n.id)
    if (isGroup(n)) n.options.forEach((o) => ids.add(o.id))
  }
  return ids
}

/**
 * Moves `id` to `index` of `container`, `index` counted before the move (the drop slot under the
 * pointer). Refused (tree unchanged) when the target is inside the node itself.
 */
export function moveNode(tree: TemplateTree, id: string, container: string, index: number): TemplateTree {
  const node = findNode(tree, id)
  const from = locate(tree, id)
  if (!node || !from || subtreeIds(node).has(container)) return tree
  const target = from.container === container && from.index < index ? index - 1 : index
  return insertNode(removeNode(tree, id), node, container, target)
}

export type ContainerInfo = { id: string; label: string; depth: number }
/** Every container, in tree order, with a French description (for the "move to" select). */
export function listContainers(tree: TemplateTree): ContainerInfo[] {
  const out: ContainerInfo[] = [{ id: ROOT, label: 'Racine du template', depth: 0 }]
  const visit = (nodes: TemplateNode[], depth: number) => {
    for (const node of nodes) {
      const name = node.label.trim() || 'Sans libellé'
      if (node.type === 'category') {
        out.push({ id: node.id, label: `Catégorie « ${name} »`, depth })
        visit(node.children, depth + 1)
      } else if (isGroup(node))
        for (const option of node.options) {
          out.push({ id: option.id, label: `« ${name} » → si « ${option.label.trim() || 'Sans libellé'} »`, depth })
          visit(option.children, depth + 1)
        }
    }
  }
  visit(tree.nodes, 1)
  return out
}

export const containerLabel = (tree: TemplateTree, id: string) =>
  listContainers(tree).find((c) => c.id === id)?.label ?? 'Emplacement inconnu'

/**
 * The node an error path points at, and the rest of the path below it: a zod issue path
 * (`["nodes", 0, "options", 1, "label"]`) or a FastAPI `loc` (Pydantic adds "body" and the union
 * tag: `["body", "nodes", 0, "text", "max_length"]`). Errors on an option belong to its group.
 */
export function issueTarget(tree: TemplateTree, path: readonly PropertyKey[]): { nodeId: string | null; rest: PropertyKey[] } {
  let current: unknown = tree
  let nodeId: string | null = null
  let rest: PropertyKey[] = []
  for (const segment of path) {
    if (segment === 'body' && current === tree) continue
    const here = current as Record<PropertyKey, unknown> | undefined
    if (here && typeof here === 'object' && 'type' in here && segment === here.type) continue
    current = here?.[segment as keyof typeof here]
    rest.push(segment)
    if (current && typeof current === 'object' && 'type' in current && 'id' in current) {
      nodeId = String(current.id)
      rest = []
    }
    if (current === undefined) break
  }
  return { nodeId, rest }
}
