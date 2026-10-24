import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Me } from '@/auth/session'
import { api, ApiError, meQueryKey, queryClient } from '@/lib/api'

export type Annex = { id: string; title: string; filename: string; size: number; sha256: string; excerpt: string; created_at: string }

export const annexesKey = ['annexes'] as const
/** Mirrors the server default `ANNEX_MAX_BYTES`; the server stays authoritative (413). */
export const MAX_ANNEX_BYTES = 20 * 1024 * 1024

export const annexFileUrl = (id: string) => `/api/annexes/${id}/file`

export function useAnnexes(q: string) {
  return useQuery({
    queryKey: [...annexesKey, 'list', q],
    queryFn: () => api<Annex[]>(`/annexes${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  })
}

export function useAnnex(id: string) {
  return useQuery({ queryKey: [...annexesKey, id], queryFn: () => api<Annex>(`/annexes/${id}`), staleTime: 60_000 })
}

/**
 * Multipart upload and DELETE with a 409 body (`{detail, templates}`) cannot go through `api()`
 * (JSON only, keeps `detail` alone), so this mirrors its CSRF/401/403 handling and rejects with an
 * ApiError whose `detail` is the whole response body.
 */
export async function annexRequest<T>(path: string, method: 'POST' | 'DELETE', body?: FormData): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const csrf = queryClient.getQueryData<Me | null>(meQueryKey)?.csrf_token
  if (csrf) headers['X-CSRF-Token'] = csrf
  let response: Response
  try {
    response = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'Serveur injoignable : vérifiez la connexion puis réessayez.')
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => null)
  if (response.ok) return payload as T
  const detail = payload?.detail
  const message =
    typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((e: { msg?: string }) => e.msg).filter(Boolean).join(' ')
        : response.status === 413
          ? 'Fichier trop volumineux.'
          : `Erreur du serveur (${response.status}). Réessayez ; si cela persiste, prévenez l'administrateur.`
  const error = new ApiError(response.status, message, payload)
  if (response.status === 401) queryClient.setQueryData(meQueryKey, null)
  if (response.status === 403) toast.error(error.message)
  throw error
}

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.max(1, bytes / 1024))} Ko`
    : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} Mo`
