import { useQuery } from '@tanstack/react-query'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, XIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { format, isValid, parseISO } from 'date-fns'
import { hasUnstorable, plural, UNSTORABLE_MESSAGE } from '@/admin/validation'
import { useMe } from '@/auth/session'
import { PageHeader } from '@/components/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button, buttonVariants } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api } from '@/lib/api'
import { useProfiles } from '@/profiles/api'
import { DateFilter } from './DateFilter'
import { OwnerBadge } from './OwnerBadge'
import { formsKey, type FormsPage } from './api'

const PAGE_SIZE = 25
const DEBOUNCE_MS = 300
const ALL = 'all' // Radix Select refuses an empty value
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short' })
const iso = (date: Date) => format(date, 'yyyy-MM-dd')
const stamp = (date?: Date) => (date ? iso(date) : '')

type Choice = { id: string; name: string; archivedLabel?: string }

/** `/fiches`: every fiche, searched and filtered server-side. Filters and page live in the URL. */
export default function FormsListPage() {
  const isAdmin = useMe().data?.role === 'admin'
  const [search, setSearch] = useSearchParams()
  const get = (key: string) => search.get(key) ?? ''
  const date = (key: string) => {
    const parsed = ISO_DAY.test(get(key)) ? parseISO(get(key)) : undefined
    return parsed && isValid(parsed) ? parsed : undefined
  }
  const page = Math.min(100_000, Math.max(1, Math.trunc(Number(get('page'))) || 1))
  const filters = { q: get('q'), reference: get('reference'), date_from: stamp(date('date_from')), date_to: stamp(date('date_to')), author_id: get('author_id'), owner_profile_id: get('owner_profile_id'), template_id: get('template_id') }
  const filtered = Object.values(filters).some(Boolean)
  // Any filter change goes back to page 1.
  const change = (patch: Record<string, string | undefined>) =>
    setSearch(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const [key, value] of Object.entries({ page: undefined, ...patch })) {
          if (value) next.set(key, value)
          else next.delete(key)
        }
        return next
      },
      { replace: true },
    )

  // The user account only reads active profiles and available templates; the admin also sees archived ones.
  const profiles = useProfiles({ archived: isAdmin })
  const templates = useQuery({
    queryKey: [...formsKey, 'template-choices', isAdmin],
    queryFn: () => api<{ id: string; name: string; archived_at?: string | null }[]>(isAdmin ? '/templates' : '/templates/available'),
  })
  const people: Choice[] = (profiles.data ?? []).map((p) => ({ id: p.id, name: p.display_name, archivedLabel: p.archived_at ? 'profil supprimé' : undefined }))
  const kinds: Choice[] = (templates.data ?? []).map((t) => ({ id: t.id, name: t.name, archivedLabel: t.archived_at ? 'archivé' : undefined }))

  const params = new URLSearchParams({ page: String(page), page_size: String(PAGE_SIZE) })
  for (const [key, value] of Object.entries(filters)) if (value.trim() && !hasUnstorable(value)) params.set(key, value.trim())
  const forms = useQuery({
    queryKey: [...formsKey, 'list', params.toString()],
    queryFn: () => api<FormsPage>(`/forms?${params}`),
    placeholderData: (previous) => previous,
  })
  const pages = forms.data ? Math.max(1, Math.ceil(forms.data.total / forms.data.page_size)) : 1

  return (
    <>
      <PageHeader
        title="Fiches"
        description="Toutes les fiches de la pharmacie, visibles par tous les profils."
        actions={
          !isAdmin && (
            <Link to="/fiches/nouvelle" className={buttonVariants({ size: 'lg' })}>
              <PlusIcon data-icon="inline-start" />
              Nouvelle fiche
            </Link>
          )
        }
      />
      <form className="mb-5 flex flex-col gap-3" aria-label="Recherche et filtres des fiches" onSubmit={(e) => e.preventDefault()}>
        <div className="flex flex-wrap items-end gap-3">
          <TextFilter id="fiches-recherche" label="Rechercher" placeholder="Ex. : amoxicilline, FIXME-000042…" className="min-w-64 flex-1 sm:max-w-md" value={filters.q} onCommit={(q) => change({ q })} />
          <TextFilter id="fiches-reference" label="Référence" placeholder="FIXME-000042" className="w-44" value={filters.reference} onCommit={(reference) => change({ reference })} />
          {filtered && (
            <Button type="button" variant="ghost" onClick={() => setSearch({}, { replace: true })}>
              <XIcon data-icon="inline-start" />
              Réinitialiser
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DateFilter label="Du" value={date('date_from')} onChange={(d) => change({ date_from: d && iso(d) })} disabled={date('date_to') && { after: date('date_to')! }} />
          <DateFilter label="Au" value={date('date_to')} onChange={(d) => change({ date_to: d && iso(d) })} disabled={date('date_from') && { before: date('date_from')! }} />
          <ChoiceFilter id="fiches-auteur" label="Auteur" all="Tous les auteurs" choices={people} value={filters.author_id} onChange={(author_id) => change({ author_id })} />
          <ChoiceFilter id="fiches-proprietaire" label="Profil propriétaire" all="Tous les profils" choices={people} value={filters.owner_profile_id} onChange={(owner_profile_id) => change({ owner_profile_id })} />
          <ChoiceFilter id="fiches-template" label="Template" all="Tous les templates" choices={kinds} value={filters.template_id} onChange={(template_id) => change({ template_id })} />
        </div>
      </form>

      {forms.isPending && <Skeleton className="h-64 w-full" role="status" aria-busy="true" aria-label="Chargement des fiches…" />}
      {forms.isError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Fiches indisponibles</AlertTitle>
          <AlertDescription>{forms.error.message}</AlertDescription>
        </Alert>
      )}
      {forms.data && forms.data.items.length === 0 && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{filtered ? 'Aucune fiche trouvée' : 'Aucune fiche'}</EmptyTitle>
            <EmptyDescription>{filtered ? 'Aucune fiche ne correspond à cette recherche. Élargissez les filtres ou réinitialisez-les.' : "Aucune fiche n'a encore été créée."}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {forms.data && forms.data.items.length > 0 && (
        <>
          <div className="rounded-xl border" aria-busy={forms.isFetching}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Référence</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Profil propriétaire</TableHead>
                  <TableHead>Créée le</TableHead>
                  <TableHead>Modifiée le</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {forms.data.items.map((form) => (
                  <TableRow key={form.id}>
                    <TableCell className="font-medium tabular-nums">
                      <Link to={`/fiches/${form.id}`} className="rounded-md text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                        {form.reference}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {form.template_name} <span className="text-muted-foreground tabular-nums">v{form.version}</span>
                    </TableCell>
                    <TableCell>
                      <OwnerBadge owner={form.owner} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{day.format(new Date(form.created_at))}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{day.format(new Date(form.updated_at))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <nav aria-label="Pagination des fiches" className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
              {plural(forms.data.total, 'fiche')} · page {page} sur {pages}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" disabled={page <= 1} onClick={() => change({ page: page > 2 ? String(page - 1) : undefined })}>
                <ChevronLeftIcon data-icon="inline-start" />
                Précédente
              </Button>
              <Button variant="outline" disabled={page >= pages} onClick={() => change({ page: String(page + 1) })}>
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

/** Text filter committed to the URL once typing pauses. Text the server would refuse (NUL, lone surrogate) is not sent. */
function TextFilter({ id, label, placeholder, className, value, onCommit }: { id: string; label: string; placeholder: string; className: string; value: string; onCommit: (text: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  useEffect(() => {
    if (text === value) return
    const timer = setTimeout(() => onCommit(text), DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // onCommit is a new closure each render; only a new text restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])
  const invalid = hasUnstorable(text)
  return (
    <Field className={className} data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} name={id} type="search" value={text} placeholder={placeholder} autoComplete="off" spellCheck={false} aria-invalid={invalid || undefined} aria-describedby={invalid ? `${id}-erreur` : undefined} onChange={(e) => setText(e.target.value)} />
      {invalid && <FieldError id={`${id}-erreur`}>{UNSTORABLE_MESSAGE}</FieldError>}
    </Field>
  )
}

function ChoiceFilter({ id, label, all, choices, value, onChange }: { id: string; label: string; all: string; choices: Choice[]; value: string; onChange: (id: string) => void }) {
  return (
    <Field className="w-52">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? '' : v)}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={ALL}>{all}</SelectItem>
            {choices.map((choice) => (
              <SelectItem key={choice.id} value={choice.id}>
                {choice.name}
                {choice.archivedLabel ? ` (${choice.archivedLabel})` : ''}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}
