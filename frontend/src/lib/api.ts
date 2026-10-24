import { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Me } from '@/auth/session'

/** Every failed call rejects with this: `message` is the French text to show the user. */
export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 4xx will not change on retry; network and 5xx errors get one more try.
      retry: (failures, error) =>
        failures < 1 && !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
})

export const meQueryKey = ['auth', 'me'] as const
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// FastAPI errors: {detail: "message"} or, for 422 validation, {detail: [{msg, loc, type}]}.
function messageOf(status: number, detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) return detail.map((e: { msg?: string }) => e.msg).filter(Boolean).join(' ')
  return `Erreur du serveur (${status}). Réessayez ; si cela persiste, prévenez l'administrateur.`
}

/**
 * fetch wrapper for `/api/*`: session cookie, JSON in and out, CSRF header on unsafe methods.
 * 401 (outside login) clears the session cache, so the route guards send the user to the login
 * page; 403 shows a toast. Both still reject with an ApiError.
 */
export async function api<T = unknown>(
  path: string,
  { method = 'GET', json }: { method?: string; json?: unknown } = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (json !== undefined) headers['Content-Type'] = 'application/json'
  if (UNSAFE.has(method)) {
    const csrf = queryClient.getQueryData<Me | null>(meQueryKey)?.csrf_token
    if (csrf) headers['X-CSRF-Token'] = csrf
  }
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: json === undefined ? undefined : JSON.stringify(json),
    })
  } catch {
    throw new ApiError(0, 'Serveur injoignable : vérifiez la connexion puis réessayez.')
  }
  if (response.status === 204) return undefined as T
  const body = await response.json().catch(() => null)
  if (response.ok) return body as T

  const error = new ApiError(response.status, messageOf(response.status, body?.detail), body?.detail)
  if (response.status === 401 && path !== '/auth/login') queryClient.setQueryData(meQueryKey, null)
  if (response.status === 403) toast.error(error.message)
  throw error
}
