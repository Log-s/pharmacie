import { useMutation, useQuery } from '@tanstack/react-query'
import { type Me } from '@/auth/session'
import { api, meQueryKey, queryClient } from '@/lib/api'

export type Profile = { id: string; display_name: string; number: number; color: string; archived_at: string | null }
export type ProfileInput = Pick<Profile, 'display_name' | 'number' | 'color'>

export const profilesKey = ['profiles'] as const

/** Active profiles (picker, switcher) or, for the admin, archived ones too. */
export function useProfiles({ archived = false, enabled = true } = {}) {
  return useQuery({
    queryKey: [...profilesKey, { archived }],
    queryFn: () => api<Profile[]>(`/profiles${archived ? '?include_archived=true' : ''}`),
    enabled,
  })
}

/** Switching needs no password; every cached query (fiches ownership, …) is refetched afterwards. */
export function useSwitchProfile() {
  return useMutation({
    mutationFn: (profileId: string) => api<Me>('/session/profile', { method: 'POST', json: { profile_id: profileId } }),
    onSuccess: (me) => {
      queryClient.setQueryData(meQueryKey, me)
      void queryClient.invalidateQueries()
    },
  })
}
