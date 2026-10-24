import { describe, expect, test } from 'vitest'
import { templateTree, type CategoryNode, type GroupNode, type TemplateTree } from '@/templates/schema'
import { insertNode, listContainers, locate, moveNode, newNode, issueTarget, removeNode, ROOT, updateNode } from '@/templates/editor/tree'

const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const make = (): TemplateTree =>
  templateTree.parse({
    nodes: [
      { id: ID(1), type: 'date', label: 'Date' },
      { id: ID(2), type: 'category', label: 'Contrôle', children: [{ id: ID(3), type: 'text', label: 'Note' }] },
      { id: ID(4), type: 'checkbox_group', label: 'Cases', options: [{ id: ID(5), label: 'Écart' }] },
    ],
  })
const ids = (tree: TemplateTree) => tree.nodes.map((n) => n.id)

describe('editor tree operations', () => {
  test('new nodes pass the schema', () => {
    for (const type of ['category', 'checkbox_group', 'radio_group', 'date', 'author', 'reference', 'text'] as const)
      expect(templateTree.safeParse({ nodes: [newNode(type)] }).success).toBe(true)
  })

  test('reorders inside a container (slot index counted before the move)', () => {
    expect(ids(moveNode(make(), ID(1), ROOT, 3))).toEqual([ID(2), ID(4), ID(1)])
    expect(ids(moveNode(make(), ID(4), ROOT, 0))).toEqual([ID(4), ID(1), ID(2)])
    expect(ids(moveNode(make(), ID(1), ROOT, 1))).toEqual([ID(1), ID(2), ID(4)])
  })

  test('nests into a category and into an option (conditional child)', () => {
    let tree = moveNode(make(), ID(1), ID(2), 0)
    expect(ids(tree)).toEqual([ID(2), ID(4)])
    expect((tree.nodes[0] as CategoryNode).children.map((n) => n.id)).toEqual([ID(1), ID(3)])
    tree = moveNode(tree, ID(3), ID(5), 0)
    expect((tree.nodes[1] as GroupNode).options[0].children.map((n) => n.id)).toEqual([ID(3)])
    expect(locate(tree, ID(3))).toEqual({ container: ID(5), index: 0 })
  })

  test('refuses to move a node into itself', () => {
    const tree = make()
    expect(moveNode(tree, ID(2), ID(2), 0)).toBe(tree)
    const nested = moveNode(tree, ID(4), ID(2), 0)
    expect(moveNode(nested, ID(2), ID(5), 0)).toBe(nested)
  })

  test('update, insert, remove', () => {
    let tree = updateNode(make(), ID(3), { label: 'Remarque' })
    expect((tree.nodes[1] as CategoryNode).children[0].label).toBe('Remarque')
    tree = insertNode(tree, newNode('author'), ID(5))
    expect((tree.nodes[2] as GroupNode).options[0].children[0].type).toBe('author')
    tree = removeNode(tree, ID(2))
    expect(ids(tree)).toEqual([ID(1), ID(4)])
  })

  test('lists containers for the "move to" select', () => {
    expect(listContainers(make()).map((c) => c.label)).toEqual(['Racine du template', 'Catégorie « Contrôle »', '« Cases » → si « Écart »'])
  })

  test('maps zod paths and server locations to the node', () => {
    const tree = make()
    expect(issueTarget(tree, ['nodes', 1, 'children', 0, 'label'])).toEqual({ nodeId: ID(3), rest: ['label'] })
    expect(issueTarget(tree, ['body', 'nodes', 1, 'category', 'children', 0, 'text', 'max_length'])).toEqual({ nodeId: ID(3), rest: ['max_length'] })
    expect(issueTarget(tree, ['nodes', 2, 'options', 0, 'label'])).toEqual({ nodeId: ID(4), rest: ['options', 0, 'label'] })
    expect(issueTarget(tree, ['nodes']).nodeId).toBeNull()
  })
})
