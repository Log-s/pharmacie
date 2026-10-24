import { ApiError } from '@/lib/api'

/**
 * U7 form errors -> the renderer's `errors` prop: 422 `detail[].loc = ["body", "data", <node id>]`
 * (or `["body", "reference"]`) and the 409 reference conflict. Anything else maps to {}: show
 * `error.message` (French) next to the form instead.
 */
export function serverFieldErrors(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {}
  if (error.status === 409) return { reference: error.message }
  if (error.status !== 422 || !Array.isArray(error.detail)) return {}
  const out: Record<string, string> = {}
  for (const item of error.detail as { loc?: unknown[]; msg?: string }[]) {
    const [, where, nodeId] = item.loc ?? []
    // The field shows its own label: drop the « Label » : prefix of the server message.
    const message = (item.msg ?? '').replace(/^Value error, /, '').replace(/^«[^»]*»\s*:\s*/, '')
    if (where === 'data' && typeof nodeId === 'string') out[nodeId] = message
    else if (where === 'reference') out.reference = message
  }
  return out
}
