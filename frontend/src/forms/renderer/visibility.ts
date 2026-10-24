import { isGroup, walk, type GroupNode, type TemplateNode, type TemplateOption } from '@/templates/schema'

// Conditional fields (spec §3.2), pure functions: an option's children are shown, validated and
// stored only while the option is selected. Mirrors U7's server rules (services/form_validation.py).

export type FieldValue = string | string[]
/** U7 `data`: node id -> value (checkbox: option ids, radio: option id, date: YYYY-MM-DD, author: profile id, text). */
export type FormData = Record<string, FieldValue | undefined>

const VALUE_TYPES = new Set<TemplateNode['type']>(['checkbox_group', 'radio_group', 'date', 'author', 'text'])
export const hasValue = (node: TemplateNode) => VALUE_TYPES.has(node.type)

export function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)
}

export function isSelected(group: GroupNode, option: TemplateOption, data: FormData): boolean {
  const value = data[group.id]
  return group.type === 'checkbox_group' ? Array.isArray(value) && value.includes(option.id) : value === option.id
}

/** The nodes the form shows for `data`, depth first. */
export function visibleNodes(nodes: TemplateNode[], data: FormData): TemplateNode[] {
  return [...walk(nodes, (group, option) => isSelected(group, option, data))]
}

/** What the API stores: visible value nodes only, no empty value, checkbox ids deduplicated in template order. */
export function cleanData(nodes: TemplateNode[], data: FormData): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {}
  for (const node of visibleNodes(nodes, data)) {
    const value = data[node.id]
    if (!hasValue(node) || isEmpty(value)) continue
    if (node.type === 'checkbox_group') {
      const picked = node.options.map((o) => o.id).filter((id) => Array.isArray(value) && value.includes(id))
      if (picked.length) out[node.id] = picked
    } else if (node.type === 'radio_group') {
      if (node.options.some((o) => o.id === value)) out[node.id] = value as string
    } else if (typeof value === 'string') out[node.id] = value
  }
  return out
}

/**
 * Setting `group` to `next`: the new data, with every value under the options that close removed,
 * and the non-empty fields that this clears (ask for confirmation when there are any).
 */
export function applySelection(group: GroupNode, next: FieldValue | undefined, data: FormData) {
  const after: FormData = { ...data, [group.id]: next }
  const closing = group.options.filter((o) => isSelected(group, o, data) && !isSelected(group, o, after))
  const hidden = closing.flatMap((o) => [...walk(o.children)]).filter(hasValue)
  for (const node of hidden) delete after[node.id]
  return { data: after, cleared: hidden.filter((node) => !isEmpty(data[node.id])) }
}

// U+0000 and lone surrogates cannot be stored by PostgreSQL / encoded as UTF-8: the API answers 422.
// oxlint-disable-next-line no-control-regex -- matching U+0000 is the point
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** French error per visible node id; hidden children are never validated. */
export function validateData(nodes: TemplateNode[], data: FormData): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const node of visibleNodes(nodes, data)) {
    const value = data[node.id]
    if (!hasValue(node)) continue
    if (isEmpty(value)) {
      if (node.required)
        errors[node.id] =
          node.type === 'checkbox_group' ? 'Cochez au moins une option.' : isGroup(node) ? 'Choisissez une option.' : 'Ce champ est obligatoire.'
    } else if (typeof value === 'string' && UNSTORABLE.test(value)) {
      errors[node.id] = 'Ce texte contient un caractère invalide\u00a0: retirez-le puis réessayez.'
    } else if (node.type === 'text' && node.max_length && typeof value === 'string' && value.length > node.max_length) {
      errors[node.id] = `${node.max_length} caractères au maximum (${value.length} saisis).`
    }
  }
  return errors
}
