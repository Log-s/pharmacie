import { useQuery } from '@tanstack/react-query'
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { PageHeader } from '@/components/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldLabel } from '@/components/ui/field'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { useProfiles } from '@/profiles/api'

type Entry = {
  id: number
  at: string
  account_role: 'admin' | 'user' | null
  profile_id: string | null
  profile_name: string | null
  action: string
  target_type: string | null
  target_id: string | null
  details: Record<string, unknown>
}
type JournalResponse = { items: Entry[]; total: number; page: number; page_size: number }

const PAGE_SIZE = 50
const ALL = 'all' // Radix Select refuses an empty value

/** French labels of the actions documented in docs/architecture.md; unknown ones show their code. */
const ACTION_LABELS: Record<string, string> = {
  login_success: 'Connexion',
  login_failure: 'Échec de connexion',
  account_locked: 'Compte verrouillé',
  logout: 'Déconnexion',
  password_reset: 'Mot de passe réinitialisé',
  profile_create: 'Profil créé',
  profile_update: 'Profil modifié',
  profile_archive: 'Profil archivé',
  profile_delete: 'Profil supprimé',
  profile_switch: 'Changement de profil',
  template_created: 'Template créé',
  template_published: 'Template publié',
  template_restored: 'Template restauré',
  template_archived: 'Template archivé',
  template_deleted: 'Template supprimé',
  annex_uploaded: 'Annexe ajoutée',
  annex_updated: 'Annexe modifiée',
  annex_deleted: 'Annexe supprimée',
  form_created: 'Fiche créée',
  form_updated: 'Fiche modifiée',
  form_deleted: 'Fiche supprimée',
  form_export: 'Fiche exportée en PDF',
}
const actionLabel = (action: string) => ACTION_LABELS[action] ?? action

const iso = (date: Date) => format(date, 'yyyy-MM-dd')

/** Admin: append-only journal, filtered server-side by date range, action and profile. */
export default function JournalPage() {
  const [filters, setFilters] = useState<{ from?: Date; to?: Date; action: string; profile: string }>({ action: ALL, profile: ALL })
  const [page, setPage] = useState(1)
  const change = (patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(1)
  }
  const actions = useQuery({ queryKey: ['journal', 'actions'], queryFn: () => api<string[]>('/journal/actions') })
  const profiles = useProfiles({ archived: true })
  const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
  if (filters.from) params.set('from', iso(filters.from))
  if (filters.to) params.set('to', iso(filters.to))
  if (filters.action !== ALL) params.set('action', filters.action)
  if (filters.profile !== ALL) params.set('profile_id', filters.profile)
  const journal = useQuery({
    queryKey: ['journal', params.toString()],
    queryFn: () => api<JournalResponse>(`/journal?${params}`),
    placeholderData: (previous) => previous,
  })
  const pages = journal.data ? Math.max(1, Math.ceil(journal.data.total / journal.data.page_size)) : 1
  const filtered = filters.from || filters.to || filters.action !== ALL || filters.profile !== ALL

  return (
    <>
      <PageHeader title="Journal d'activité" description="Qui a fait quoi, et quand. Le journal est en ajout seul : rien ne peut y être modifié ni supprimé." />
      <form className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filtres du journal" onSubmit={(e) => e.preventDefault()}>
        <DateFilter label="Du" value={filters.from} onChange={(from) => change({ from })} disabled={filters.to && { after: filters.to }} />
        <DateFilter label="Au" value={filters.to} onChange={(to) => change({ to })} disabled={filters.from && { before: filters.from }} />
        <Field className="w-52">
          <FieldLabel htmlFor="journal-action">Action</FieldLabel>
          <Select value={filters.action} onValueChange={(action) => change({ action })}>
            <SelectTrigger id="journal-action" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL}>Toutes les actions</SelectItem>
                {actions.data?.map((action) => (
                  <SelectItem key={action} value={action}>
                    {actionLabel(action)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field className="w-52">
          <FieldLabel htmlFor="journal-profile">Profil</FieldLabel>
          <Select value={filters.profile} onValueChange={(profile) => change({ profile })}>
            <SelectTrigger id="journal-profile" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL}>Tous les profils</SelectItem>
                {profiles.data?.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.display_name}
                    {profile.archived_at ? ' (archivé)' : ''}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {filtered && (
          <Button type="button" variant="ghost" onClick={() => change({ from: undefined, to: undefined, action: ALL, profile: ALL })}>
            <XIcon data-icon="inline-start" />
            Réinitialiser
          </Button>
        )}
      </form>

      {journal.isPending && <Skeleton className="h-64 w-full" aria-busy="true" aria-label="Chargement du journal" />}
      {journal.isError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Journal indisponible</AlertTitle>
          <AlertDescription>{journal.error.message}</AlertDescription>
        </Alert>
      )}
      {journal.data?.items.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Aucune entrée</EmptyTitle>
            <EmptyDescription>{filtered ? 'Aucune activité ne correspond à ces filtres.' : "Aucune activité n'a encore été enregistrée."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {journal.data && journal.data.items.length > 0 && (
        <>
          <div className="rounded-xl border" aria-busy={journal.isFetching}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Auteur</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Cible</TableHead>
                  <TableHead>Détails</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {journal.data.items.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} />
                ))}
              </TableBody>
            </Table>
          </div>
          <nav aria-label="Pagination du journal" className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
              {journal.data.total} entrée{journal.data.total > 1 ? 's' : ''} · page {page} sur {pages}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeftIcon data-icon="inline-start" />
                Précédente
              </Button>
              <Button variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Suivante
                <ChevronRightIcon data-icon="inline-end" />
              </Button>
            </div>
          </nav>
        </>
      )}
    </>
  )
}

function EntryRow({ entry }: { entry: Entry }) {
  const author = entry.profile_name ?? (entry.account_role === 'admin' ? 'Administrateur' : entry.account_role === 'user' ? 'Utilisateur (sans profil)' : 'Serveur')
  const hasDetails = Object.keys(entry.details).length > 0
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap tabular-nums">{format(new Date(entry.at), 'dd/MM/yyyy HH:mm:ss', { locale: fr })}</TableCell>
      <TableCell>{author}</TableCell>
      <TableCell>
        <span className="font-medium">{actionLabel(entry.action)}</span>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {entry.target_type ? (
          <>
            {entry.target_type}
            {entry.target_id && <span className="block max-w-32 truncate text-xs tabular-nums" title={entry.target_id}>{entry.target_id}</span>}
          </>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell>
        {hasDetails ? (
          <details>
            <summary className="cursor-pointer rounded-md text-sm text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Voir</summary>
            <pre className="mt-1 max-w-xs overflow-x-auto text-xs whitespace-pre-wrap break-words">{JSON.stringify(entry.details, null, 1)}</pre>
          </details>
        ) : (
          '—'
        )}
      </TableCell>
    </TableRow>
  )
}

function DateFilter({ label, value, onChange, disabled }: { label: string; value?: Date; onChange: (date?: Date) => void; disabled?: React.ComponentProps<typeof Calendar>['disabled'] }) {
  const [open, setOpen] = useState(false)
  return (
    <Field className="w-44">
      <FieldLabel id={`date-${label}`}>{label}</FieldLabel>
      <div className="flex gap-1">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" aria-labelledby={`date-${label}`} className="flex-1 justify-start font-normal tabular-nums">
              <CalendarIcon data-icon="inline-start" />
              {value ? format(value, 'd MMM yyyy', { locale: fr }) : 'Choisir'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              locale={fr}
              selected={value}
              disabled={disabled}
              onSelect={(date) => {
                onChange(date)
                setOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>
        {value && (
          <Button type="button" variant="ghost" size="icon" aria-label={`Effacer la date « ${label} »`} onClick={() => onChange(undefined)}>
            <XIcon />
          </Button>
        )}
      </div>
    </Field>
  )
}
