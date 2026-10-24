import { Navigate, Outlet, useLocation } from 'react-router'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusPage } from '@/components/StatusPage'
import { type Role, session, useMe } from '@/auth/session'

/** Layout route: anonymous visitors go to the login page, coming back here afterwards. */
export function RequireAuth() {
  const me = useMe()
  const location = useLocation()
  if (me.isPending) {
    return (
      <div className="mx-auto flex max-w-6xl flex-col gap-3 p-6" aria-busy="true" aria-label="Chargement">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }
  if (me.isError) {
    return <StatusPage title="Serveur injoignable" description={me.error.message} />
  }
  if (!me.data) return <Navigate to="/connexion" replace state={session.loggedOut ? null : { from: location }} />
  return <Outlet />
}

/** Layout route for pages of one role; the other role gets a 403 page (the API refuses anyway). */
export function RequireRole({ allow }: { allow: Role }) {
  const { data: me } = useMe()
  if (me?.role !== allow) {
    return (
      <StatusPage
        title="Accès refusé"
        description={
          allow === 'admin'
            ? "Cette page est réservée à l'administrateur."
            : 'Cette page est réservée au compte utilisateur.'
        }
      />
    )
  }
  return <Outlet />
}

/** Layout route: the user account must pick a profile before anything else (spec §2.2). */
export function RequireProfile() {
  const { data: me } = useMe()
  if (me?.role === 'user' && !me.active_profile) return <Navigate to="/profil" replace />
  return <Outlet />
}
