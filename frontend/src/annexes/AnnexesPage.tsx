import { ExternalLinkIcon, PencilIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { hasUnstorable, UNSTORABLE_MESSAGE } from '@/admin/validation'
import { PageHeader } from '@/components/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/auth/session'
import { type Annex, annexFileUrl, formatSize, useAnnexes } from '@/annexes/api'
import { DeleteAnnexDialog, EditAnnexDialog } from '@/annexes/AnnexDialogs'
import { AnnexUpload } from '@/annexes/AnnexUpload'

const longDay = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' })

/** Annexes for both roles: search, open the PDF; the admin also uploads, edits and deletes. */
export default function AnnexesPage() {
  const isAdmin = useMe().data?.role === 'admin'
  // The search term lives in the URL (?q=), debounced while typing.
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [search, setSearch] = useState(q)
  const invalid = hasUnstorable(search)
  useEffect(() => {
    const timer = setTimeout(() => setParams(invalid || !search.trim() ? {} : { q: search.trim() }, { replace: true }), 250)
    return () => clearTimeout(timer)
  }, [search, invalid, setParams])
  const annexes = useAnnexes(q)
  const [editing, setEditing] = useState<Annex>()
  const [deleting, setDeleting] = useState<Annex>()

  return (
    <>
      <PageHeader title="Annexes" description="Les documents PDF de référence liés aux fiches." />
      {isAdmin && <AnnexUpload />}
      <Field className="mb-4 max-w-md" data-invalid={invalid}>
        <FieldLabel htmlFor="annex-search">Rechercher une annexe</FieldLabel>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="annex-search" name="q" type="search" autoComplete="off" className="pl-8" placeholder="Titre ou contenu…" value={search} onChange={(e) => setSearch(e.target.value)} aria-invalid={invalid} />
        </div>
        {invalid && <FieldError>{UNSTORABLE_MESSAGE}</FieldError>}
      </Field>
      <div aria-live="polite">
        {annexes.isPending && <Skeleton className="h-32 w-full" aria-busy="true" aria-label="Chargement des annexes" />}
        {annexes.isError && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Annexes indisponibles</AlertTitle>
            <AlertDescription>{annexes.error.message}</AlertDescription>
          </Alert>
        )}
        {annexes.data?.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>{q ? 'Aucune annexe trouvée' : 'Aucune annexe'}</EmptyTitle>
              <EmptyDescription>
                {q ? 'Essayez un autre mot, ou videz la recherche.' : isAdmin ? 'Ajoutez un premier PDF avec le formulaire ci-dessus.' : "L'administrateur n'a encore ajouté aucun document."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {annexes.data && annexes.data.length > 0 && (
          <ul className="divide-y rounded-xl border bg-card">
            {annexes.data.map((annex) => (
              <li key={annex.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-4">
                <div className="flex min-w-0 max-w-prose flex-1 flex-col gap-1">
                  <a href={annexFileUrl(annex.id)} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-md font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50">
                    {annex.title}
                    <ExternalLinkIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <span className="sr-only">(PDF, nouvel onglet)</span>
                  </a>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {annex.filename} · {formatSize(annex.size)} · ajoutée le {longDay.format(new Date(annex.created_at))}
                  </p>
                  {annex.excerpt && <p className="line-clamp-2 text-sm text-pretty text-muted-foreground">{annex.excerpt}</p>}
                </div>
                {isAdmin && (
                  <div className="flex gap-1">
                    <Button variant="ghost" onClick={() => setEditing(annex)} aria-label={`Modifier ${annex.title}`}>
                      <PencilIcon data-icon="inline-start" />
                      Modifier
                    </Button>
                    <Button variant="ghost" onClick={() => setDeleting(annex)} aria-label={`Supprimer ${annex.title}`}>
                      <Trash2Icon data-icon="inline-start" />
                      Supprimer
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {editing && <EditAnnexDialog key={editing.id} annex={editing} onClose={() => setEditing(undefined)} />}
      {deleting && <DeleteAnnexDialog key={deleting.id} annex={deleting} onClose={() => setDeleting(undefined)} />}
    </>
  )
}
