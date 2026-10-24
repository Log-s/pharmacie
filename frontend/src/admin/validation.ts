import { ApiError } from '@/lib/api'

/** PostgreSQL text cannot hold NUL and UTF-8 cannot encode a lone surrogate (server answers 422). */
// eslint-disable-next-line no-control-regex
const UNSTORABLE = /\u0000|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/

export const hasUnstorable = (value: string) => UNSTORABLE.test(value)
export const UNSTORABLE_MESSAGE = 'Le texte ne peut pas contenir de caractère nul ou invalide.'

/** Maps a FastAPI 422 (`detail: [{loc, msg}]`) to `{field: message}`; other errors map to `{}`. */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError) || error.status !== 422 || !Array.isArray(error.detail)) return {}
  const out: Record<string, string> = {}
  for (const item of error.detail as { loc?: unknown[]; msg?: string }[]) {
    const field = String(item.loc?.at(-1) ?? '')
    if (field && item.msg && !(field in out)) out[field] = item.msg
  }
  return out
}

/** Pluralised French count: `plural(2, 'fiche')` → « 2 fiches ». */
export const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

/** Focus the first invalid field once its error has rendered. By id: shadcn `Input` drops `ref` under React 18. */
export const focusFirstInvalid = (errors: Record<string, string>, ids: Record<string, string>) =>
  setTimeout(() => document.getElementById(ids[Object.keys(ids).find((key) => errors[key]) ?? ''])?.focus(), 0)
