import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Me } from '@/auth/session'
import { api, ApiError, meQueryKey, queryClient } from '@/lib/api'

export type Folder = { id: string; name: string; parent_id: string | null }
/** A note as listed by the tree and the search (no body). */
export type NoteItem = { id: string; title: string; folder_id: string | null; excerpt: string; updated_at: string }
export type Note = NoteItem & { body_html: string; created_at: string }
export type Tree = { folders: Folder[]; notes: NoteItem[] }

export const annexesKey = ['annexes'] as const

export const useAnnexTree = () => useQuery({ queryKey: [...annexesKey, 'tree'], queryFn: () => api<Tree>('/annexes/tree') })

export const useAnnexSearch = (q: string) =>
  useQuery({ queryKey: [...annexesKey, 'search', q], queryFn: () => api<NoteItem[]>(`/annexes?q=${encodeURIComponent(q)}`), enabled: !!q })

export const useNote = (id: string | undefined) =>
  useQuery({ queryKey: [...annexesKey, id], queryFn: () => api<Note>(`/annexes/${id}`), staleTime: 60_000, enabled: !!id })

/** PDF of a folder's subtree; the whole tree when no folder is given. */
export const annexExportUrl = (folderId?: string | null) => `/api/annexes/export.pdf${folderId ? `?folder_id=${folderId}` : ''}`

const group = <T,>(items: T[], key: (item: T) => string | null, label: (item: T) => string) => {
  const groups = new Map<string | null, T[]>()
  for (const item of [...items].sort((a, b) => label(a).localeCompare(label(b), 'fr'))) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}

/** Client-side view of the flat tree: children sorted alphabetically (folders, then notes). */
export function indexTree({ folders, notes }: Tree) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const subfolders = group(folders, (folder) => folder.parent_id, (folder) => folder.name)
  return {
    byId,
    subfolders,
    notesIn: group(notes, (note) => note.folder_id, (note) => note.title),
    /** Folders from the root down to `id` (empty for the root). */
    path(id: string | null) {
      const chain: Folder[] = []
      for (let folder = id ? byId.get(id) : undefined; folder && !chain.includes(folder); folder = folder.parent_id ? byId.get(folder.parent_id) : undefined)
        chain.unshift(folder)
      return chain
    },
    /** Every folder below `id`, `id` excluded. */
    descendants(id: string) {
      const found = new Set<string>()
      const todo = [id]
      for (let next = todo.pop(); next; next = todo.pop())
        for (const child of subfolders.get(next) ?? []) {
          if (found.has(child.id)) continue
          found.add(child.id)
          todo.push(child.id)
        }
      return found
    },
  }
}
export type TreeIndex = ReturnType<typeof indexTree>

/** « Annexes / Protocoles / Stupéfiants » for a folder id (null = root). */
export const pathLabel = (index: TreeIndex, id: string | null) => ['Annexes', ...index.path(id).map((folder) => folder.name)].join(' / ')

/**
 * DELETE with a 409 body (`{detail, templates}`) cannot go through `api()` (it keeps `detail` alone),
 * so this mirrors its CSRF/401/403 handling and rejects with an ApiError whose `detail` is the whole body.
 */
export async function annexRequest(path: string): Promise<void> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  const csrf = queryClient.getQueryData<Me | null>(meQueryKey)?.csrf_token
  if (csrf) headers['X-CSRF-Token'] = csrf
  let response: Response
  try {
    response = await fetch(`/api${path}`, { method: 'DELETE', headers, credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'Serveur injoignable : vérifiez la connexion puis réessayez.')
  }
  if (response.status === 204) return
  const payload = await response.json().catch(() => null)
  if (response.ok) return
  const detail = payload?.detail
  const message =
    typeof detail === 'string'
      ? detail
      : Array.isArray(detail)
        ? detail.map((e: { msg?: string }) => e.msg).filter(Boolean).join(' ')
        : `Erreur du serveur (${response.status}). Réessayez ; si cela persiste, prévenez l'administrateur.`
  const error = new ApiError(response.status, message, payload)
  if (response.status === 401) queryClient.setQueryData(meQueryKey, null)
  if (response.status === 403) toast.error(error.message)
  throw error
}
