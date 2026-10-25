import { useQuery } from '@tanstack/react-query'
import { format, isValid, parse } from 'date-fns'
import { fr } from 'date-fns/locale'
import { api } from '@/lib/api'

export type Profile = { id: string; display_name: string; number: number; color: string; archived_at: string | null }

/** DOM id of a node's (first) control: focus target for errors, `htmlFor` of its label. */
export const fieldId = (nodeId: string) => `champ-${nodeId}`
export const nodeLabel = (node: { label: string }) => node.label.trim() || 'Sans libellé'

export const toIsoDate = (date: Date) => format(date, 'yyyy-MM-dd')
export function parseIsoDate(value: string | undefined) {
  const date = value ? parse(value, 'yyyy-MM-dd', new Date()) : undefined
  return date && isValid(date) ? date : undefined
}
export const formatDate = (date: Date) => format(date, 'd MMMM yyyy', { locale: fr })

/** Active profiles (U4), for the author select and its read-only display. */
export function useProfiles(enabled = true) {
  return useQuery({ queryKey: ['profiles', 'active'], queryFn: () => api<Profile[]>('/profiles'), enabled, staleTime: 60_000 })
}
