import { useMutation, useQuery } from '@tanstack/react-query'
import { api, ApiError, meQueryKey, queryClient } from '@/lib/api'

export type Role = 'admin' | 'user'
export type ActiveProfile = { id: string; display_name: string; initials: string; color: string }
/** `GET /api/auth/me`; `null` in the cache means "not logged in". */
export type Me = { role: Role; active_profile: ActiveProfile | null; csrf_token: string }

export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: () =>
      api<Me>('/auth/me').catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }),
    staleTime: Infinity, // refreshed by login, logout, profile change, or any 401
  })
}

export function useLogin() {
  return useMutation({
    mutationFn: (body: { role: Role; password: string }) =>
      api<Me>('/auth/login', { method: 'POST', json: body }),
    onSuccess: (me) => queryClient.setQueryData(meQueryKey, me),
  })
}

export function useLogout() {
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    // Even if the server call fails, forget everything client-side: the guards show the login page.
    onSettled: () => {
      queryClient.clear()
      queryClient.setQueryData(meQueryKey, null)
    },
  })
}
