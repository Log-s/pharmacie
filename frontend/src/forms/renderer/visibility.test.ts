import { describe, expect, test } from 'vitest'
import { applySelection, cleanData, validateData, visibleNodes } from '@/forms/renderer/visibility'
import { templateTree, type GroupNode, type TemplateNode } from '@/templates/schema'

const nodes: TemplateNode[] = templateTree.parse({
  nodes: [
    { id: '00000000-0000-4000-8000-000000000001', type: 'reference', label: 'Référence' },
    {
      id: '00000000-0000-4000-8000-000000000002',
      type: 'checkbox_group',
      label: 'Contrôles',
      options: [
        { id: '00000000-0000-4000-8000-000000000003', label: 'Étiquette' },
        {
          id: '00000000-0000-4000-8000-000000000004',
          label: 'Écart',
          children: [
            { id: '00000000-0000-4000-8000-000000000005', type: 'text', label: 'Description', required: true, max_length: 5 },
            {
              id: '00000000-0000-4000-8000-000000000006',
              type: 'radio_group',
              label: 'Gravité',
              options: [
                { id: '00000000-0000-4000-8000-000000000007', label: 'Faible' },
                { id: '00000000-0000-4000-8000-000000000008', label: 'Forte', children: [{ id: '00000000-0000-4000-8000-000000000009', type: 'date', label: 'Signalé le' }] },
              ],
            },
          ],
        },
      ],
    },
    { id: '00000000-0000-4000-8000-000000000010', type: 'category', label: 'Fin', children: [{ id: '00000000-0000-4000-8000-000000000011', type: 'author', label: 'Auteur', required: true }] },
  ],
}).nodes
const [, checks, end] = nodes
const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const severity = (checks as GroupNode).options[1].children[1] as GroupNode

describe('visibility: conditional children', () => {
  test('children of an unselected option are not visible', () => {
    expect(visibleNodes(nodes, {}).map((n) => n.label)).toEqual(['Référence', 'Contrôles', 'Fin', 'Auteur'])
    expect(visibleNodes(nodes, { [ID(2)]: [ID(4)] }).map((n) => n.label)).toEqual([
      'Référence', 'Contrôles', 'Description', 'Gravité', 'Fin', 'Auteur',
    ])
  })

  test('hidden children are excluded from the output data, empty values and unknown keys too', () => {
    const data = { [ID(2)]: [ID(3)], [ID(5)]: 'cassé', [ID(6)]: ID(8), [ID(9)]: '2026-10-24', [ID(11)]: '', zzz: 'x' }
    expect(cleanData(nodes, data)).toEqual({ [ID(2)]: [ID(3)] })
  })

  test('output matches the U7 format: checkbox ids deduplicated in template order, radio id, strings', () => {
    const data = { [ID(2)]: [ID(4), ID(3), ID(4)], [ID(5)]: 'abc', [ID(6)]: ID(8), [ID(9)]: '2026-10-24', [ID(11)]: 'p1' }
    expect(cleanData(nodes, data)).toEqual({
      [ID(2)]: [ID(3), ID(4)], [ID(5)]: 'abc', [ID(6)]: ID(8), [ID(9)]: '2026-10-24', [ID(11)]: 'p1',
    })
    expect(cleanData(nodes, { [ID(2)]: [], [ID(11)]: '   ' })).toEqual({})
    expect(cleanData(nodes, { [ID(2)]: [ID(4)], [ID(6)]: 'not-an-option' })).toEqual({ [ID(2)]: [ID(4)] })
  })

  test('hidden children are not validated', () => {
    expect(validateData(nodes, {})).toEqual({ [ID(11)]: 'Ce champ est obligatoire.' })
    expect(validateData(nodes, { [ID(2)]: [ID(4)], [ID(11)]: 'p1' })).toEqual({ [ID(5)]: 'Ce champ est obligatoire.' })
    expect(validateData(nodes, { [ID(2)]: [ID(4)], [ID(5)]: 'trop long', [ID(11)]: 'p1' })).toEqual({ [ID(5)]: '5 caractères au maximum (9 saisis).' })
    expect(validateData(nodes, { [ID(2)]: [ID(3)], [ID(5)]: 'trop long', [ID(11)]: 'p1' })).toEqual({})
    expect(validateData(nodes, { [ID(11)]: 'a\u0000' })[ID(11)]).toMatch(/caractère invalide/)
  })

  test('unchecking an option clears all its descendants and reports the non-empty ones', () => {
    const data = { [ID(2)]: [ID(3), ID(4)], [ID(5)]: 'abc', [ID(6)]: ID(8), [ID(9)]: '2026-10-24', [ID(11)]: 'p1' }
    const { data: after, cleared } = applySelection(checks as GroupNode, [ID(3)], data)
    expect(after).toEqual({ [ID(2)]: [ID(3)], [ID(11)]: 'p1' })
    expect(cleared.map((n) => n.label)).toEqual(['Description', 'Gravité', 'Signalé le'])
  })

  test('unchecking an option whose children are empty needs no confirmation', () => {
    const { data: after, cleared } = applySelection(checks as GroupNode, [], { [ID(2)]: [ID(4)], [ID(5)]: '  ' })
    expect(cleared).toEqual([])
    expect(after).toEqual({ [ID(2)]: [] })
  })

  test('checking another option keeps the values of options that stay selected', () => {
    const data = { [ID(2)]: [ID(4)], [ID(5)]: 'abc' }
    expect(applySelection(checks as GroupNode, [ID(3), ID(4)], data)).toEqual({ data: { [ID(2)]: [ID(3), ID(4)], [ID(5)]: 'abc' }, cleared: [] })
  })

  test('switching a radio option clears the previous option children', () => {
    const data = { [ID(2)]: [ID(4)], [ID(6)]: ID(8), [ID(9)]: '2026-10-24' }
    const { data: after, cleared } = applySelection(severity, ID(7), data)
    expect(after).toEqual({ [ID(2)]: [ID(4)], [ID(6)]: ID(7) })
    expect(cleared.map((n) => n.label)).toEqual(['Signalé le'])
    expect(end.type).toBe('category')
  })
})
