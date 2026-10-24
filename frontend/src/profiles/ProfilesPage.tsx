import { useMutation, useQuery } from '@tanstack/react-query'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { plural } from '@/admin/validation'
import { PageHeader } from '@/components/PageHeader'
import { Paraphe } from '@/components/ProfileSwitcher'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, queryClient } from '@/lib/api'
import { type Profile, profilesKey, useProfiles } from '@/profiles/api'
import { ProfileFormDialog } from '@/profiles/ProfileFormDialog'

/** Admin: create, edit and delete (or archive) profiles. */
export default function ProfilesPage() {
  const profiles = useProfiles({ archived: true })
  // `null` = create dialog; a Profile = edit dialog; `undefined` = closed.
  const [editing, setEditing] = useState<Profile | null | undefined>()
  const [deleting, setDeleting] = useState<Profile>()

  return (
    <>
      <PageHeader
        title="Profils"
        description="Les profils de l'équipe : nom affiché, initiales et couleur."
        actions={
          <Button onClick={() => setEditing(null)}>
            <PlusIcon data-icon="inline-start" />
            Nouveau profil
          </Button>
        }
      />
      {profiles.isPending && <Skeleton className="h-40 w-full" aria-busy="true" aria-label="Chargement des profils" />}
      {profiles.isError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Profils indisponibles</AlertTitle>
          <AlertDescription>{profiles.error.message}</AlertDescription>
        </Alert>
      )}
      {profiles.data?.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Aucun profil</EmptyTitle>
            <EmptyDescription>Créez un premier profil : le compte utilisateur doit en choisir un pour travailler.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {profiles.data && profiles.data.length > 0 && (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Profil</TableHead>
                <TableHead>Initiales</TableHead>
                <TableHead>Couleur</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profiles.data.map((profile) => (
                <TableRow key={profile.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Paraphe initials={profile.initials} color={profile.color} />
                      <span className="font-medium">{profile.display_name}</span>
                      {profile.archived_at && <Badge variant="secondary">Archivé</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums">{profile.initials}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{profile.color}</TableCell>
                  <TableCell>
                    {!profile.archived_at && (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(profile)} aria-label={`Modifier ${profile.display_name}`}>
                          <PencilIcon data-icon="inline-start" />
                          Modifier
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setDeleting(profile)} aria-label={`Supprimer ${profile.display_name}`}>
                          <Trash2Icon data-icon="inline-start" />
                          Supprimer
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing !== undefined && (
        <ProfileFormDialog key={editing?.id ?? 'new'} profile={editing ?? undefined} open onOpenChange={(open) => !open && setEditing(undefined)} />
      )}
      {deleting && <DeleteProfileDialog profile={deleting} onClose={() => setDeleting(undefined)} />}
    </>
  )
}

/** Confirmation that states what will happen: archive when the profile owns fiches, delete otherwise. */
export function DeleteProfileDialog({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const impact = useQuery({
    queryKey: ['profiles', profile.id, 'deletion-impact'],
    queryFn: () => api<{ forms_count: number; will_archive: boolean }>(`/profiles/${profile.id}/deletion-impact`),
    gcTime: 0, // always fresh: a fiche may have been created since the last look
  })
  const remove = useMutation({
    mutationFn: () => api<{ forms_count: number; archived: boolean }>(`/profiles/${profile.id}`, { method: 'DELETE' }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: profilesKey })
      toast.success(result.archived ? `Profil archivé (${plural(result.forms_count, 'fiche')} conservée${result.forms_count > 1 ? 's' : ''}).` : 'Profil supprimé.')
    },
    onError: (error) => toast.error(error.message),
    onSettled: onClose,
  })
  const archive = impact.data?.will_archive

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer le profil « {profile.display_name} » ?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div aria-live="polite">
              {impact.isPending && <p>Vérification des fiches liées…</p>}
              {impact.isError && <p>{impact.error.message}</p>}
              {impact.data && archive && (
                <p>
                  Ce profil possède {plural(impact.data.forms_count, 'fiche')}. Il sera <strong>archivé</strong> : il disparaît du sélecteur de profil, et ses fiches restent consultables en
                  lecture seule sous la mention « {profile.display_name} (profil supprimé) ».
                </p>
              )}
              {impact.data && !archive && <p>Ce profil n'a aucune fiche : il sera <strong>supprimé définitivement</strong>.</p>}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Annuler</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={!impact.data || remove.isPending}
            onClick={(event) => {
              event.preventDefault()
              remove.mutate()
            }}
          >
            {archive ? 'Archiver le profil' : 'Supprimer définitivement'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
