import { CheckIcon } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Paraphe } from '@/components/ProfileSwitcher'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/auth/session'
import { useProfiles, useSwitchProfile } from '@/profiles/api'

/** Shown right after the user login (and from the header): one card per active profile. */
export default function ProfilePickerPage() {
  const activeId = useMe().data?.active_profile?.id
  const profiles = useProfiles()
  const switchProfile = useSwitchProfile()
  const navigate = useNavigate()
  const from = (useLocation().state as { from?: { pathname: string } } | null)?.from?.pathname

  const choose = (id: string) =>
    switchProfile.mutate(id, {
      onSuccess: () => navigate(from ?? '/fiches'),
      onError: () => void profiles.refetch(), // e.g. the profile was archived meanwhile
    })

  return (
    <>
      <PageHeader
        title="Choix du profil"
        description="Choisissez le profil sous lequel vous travaillez. Vous pourrez en changer à tout moment depuis l'en-tête."
      />
      {switchProfile.isError && (
        <Alert variant="destructive" className="mb-4" role="alert">
          <AlertTitle>Profil non sélectionné</AlertTitle>
          <AlertDescription>{switchProfile.error.message}</AlertDescription>
        </Alert>
      )}
      {profiles.isPending && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Chargement des profils">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      {profiles.isError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Profils indisponibles</AlertTitle>
          <AlertDescription>{profiles.error.message}</AlertDescription>
        </Alert>
      )}
      {profiles.data?.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Aucun profil disponible</EmptyTitle>
            <EmptyDescription>L'administrateur doit d'abord créer un profil depuis l'écran Profils.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {profiles.data && profiles.data.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {profiles.data.map((profile) => (
            <li key={profile.id}>
              <button
                type="button"
                disabled={switchProfile.isPending}
                aria-current={profile.id === activeId ? 'true' : undefined}
                onClick={() => choose(profile.id)}
                className="flex min-h-20 w-full items-center gap-3 rounded-xl border bg-card p-4 text-left outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-[current=true]:border-primary"
              >
                <Paraphe number={profile.number} color={profile.color} className="size-11 rounded-lg text-base" />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">{profile.display_name}</span>
                  {profile.id === activeId && (
                    <span className="flex items-center gap-1 text-sm text-primary">
                      <CheckIcon className="size-3.5" aria-hidden="true" />
                      Profil actif
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
