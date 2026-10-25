import { ChevronRightIcon, FileTextIcon, FolderIcon, FolderPlusIcon, FileDownIcon, FilePlusIcon, FolderInputIcon, PencilIcon, SearchIcon, Trash2Icon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { hasUnstorable, UNSTORABLE_MESSAGE } from '@/admin/validation'
import { PageHeader } from '@/components/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/auth/session'
import { cn } from '@/lib/utils'
import { type NoteItem, type TreeIndex, annexExportUrl, indexTree, pathLabel, useAnnexSearch, useAnnexTree } from '@/annexes/api'
import { DeleteDialog, FolderDialog, MoveDialog, type Target } from '@/annexes/AnnexDialogs'

const shortDay = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })
const folderHref = (id: string | null) => (id ? `/annexes?dossier=${id}` : '/annexes')
const noteHref = (id: string) => `/annexes/notes/${id}`
const rowLink = 'rounded-md outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50'

type Dialog = { kind: 'folder'; rename: boolean } | { kind: 'move'; target: Target } | { kind: 'delete'; target: Target }

/** Annexes for both roles: folder tree, folder content, search and PDF export; the admin also edits the structure. */
export default function AnnexesPage() {
  const isAdmin = useMe().data?.role === 'admin'
  const [params, setParams] = useSearchParams()
  const tree = useAnnexTree()
  const index = useMemo(() => (tree.data ? indexTree(tree.data) : undefined), [tree.data])
  const dossier = params.get('dossier')
  const current = dossier ? index?.byId.get(dossier) : undefined

  // The search belongs to the folder it was typed in: picking another folder leaves it.
  const [typed, setTyped] = useState({ text: '', dossier })
  const search = typed.dossier === dossier ? typed.text : ''
  const [debounced, setDebounced] = useState('')
  const q = search.trim() ? debounced : ''
  const invalid = hasUnstorable(search)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(invalid ? '' : search.trim()), 250)
    return () => clearTimeout(timer)
  }, [search, invalid])
  const results = useAnnexSearch(q)
  const [dialog, setDialog] = useState<Dialog>()

  return (
    <>
      <PageHeader title="Annexes" description="Les notes de référence liées aux fiches, rangées par dossier." />
      <Field className="mb-4 max-w-md" data-invalid={invalid}>
        <FieldLabel htmlFor="annex-search">Rechercher une annexe</FieldLabel>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input id="annex-search" name="q" type="search" autoComplete="off" className="pl-8" placeholder="Titre ou contenu…" value={search} onChange={(e) => setTyped({ text: e.target.value, dossier })} aria-invalid={invalid} />
        </div>
        {invalid && <FieldError>{UNSTORABLE_MESSAGE}</FieldError>}
      </Field>
      {tree.isPending && <Skeleton className="h-48 w-full" aria-busy="true" aria-label="Chargement des annexes" />}
      {tree.isError && (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Annexes indisponibles</AlertTitle>
          <AlertDescription>{tree.error.message}</AlertDescription>
        </Alert>
      )}
      {tree.data && index && (
        <div className="grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)] md:gap-6">
          <nav aria-label="Arborescence des annexes" className="self-start rounded-xl border bg-card p-2">
            <TreeNav index={index} currentId={current?.id ?? null} />
          </nav>
          <section aria-label="Contenu du dossier" className="flex min-w-0 flex-col gap-4">
            {q ? (
              <div aria-live="polite">
                <SearchResults results={results} index={index} />
              </div>
            ) : dossier && !current ? (
              <Empty className="border">
                <EmptyHeader>
                  <EmptyTitle>Dossier introuvable</EmptyTitle>
                  <EmptyDescription>
                    Il a été supprimé ou déplacé. <Link to="/annexes" className="underline">Revenir à la racine</Link>.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <Breadcrumb index={index} currentId={current?.id ?? null} />
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" asChild>
                    <a href={annexExportUrl(current?.id)} target="_blank" rel="noopener">
                      <FileDownIcon data-icon="inline-start" />
                      Exporter en PDF
                      <span className="sr-only">(nouvel onglet)</span>
                    </a>
                  </Button>
                  {isAdmin && (
                    <>
                      <Button variant="outline" onClick={() => setDialog({ kind: 'folder', rename: false })}>
                        <FolderPlusIcon data-icon="inline-start" />
                        Nouveau dossier
                      </Button>
                      <Button asChild>
                        <Link to={current ? `/annexes/notes/nouvelle?dossier=${current.id}` : '/annexes/notes/nouvelle'}>
                          <FilePlusIcon data-icon="inline-start" />
                          Nouvelle note
                        </Link>
                      </Button>
                      {current && (
                        <>
                          <Button variant="ghost" onClick={() => setDialog({ kind: 'folder', rename: true })}>
                            <PencilIcon data-icon="inline-start" />
                            Renommer
                          </Button>
                          <Button variant="ghost" onClick={() => setDialog({ kind: 'move', target: { kind: 'folder', folder: current } })}>
                            <FolderInputIcon data-icon="inline-start" />
                            Déplacer
                          </Button>
                          <Button variant="ghost" onClick={() => setDialog({ kind: 'delete', target: { kind: 'folder', folder: current } })}>
                            <Trash2Icon data-icon="inline-start" />
                            Supprimer
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
                <FolderContent index={index} folderId={current?.id ?? null} isAdmin={isAdmin} onAction={setDialog} />
              </>
            )}
          </section>
        </div>
      )}
      {dialog?.kind === 'folder' && <FolderDialog folder={dialog.rename ? current : undefined} parentId={current?.id ?? null} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'move' && index && <MoveDialog target={dialog.target} index={index} onClose={() => setDialog(undefined)} />}
      {dialog?.kind === 'delete' && tree.data && index && (
        <DeleteDialog
          target={dialog.target}
          tree={tree.data}
          index={index}
          onClose={() => setDialog(undefined)}
          onDeleted={dialog.target.kind === 'folder' ? () => setParams(current?.parent_id ? { dossier: current.parent_id } : {}) : undefined}
        />
      )}
    </>
  )
}

/** Collapsible folders with their notes; the path to the current folder is kept open. */
function TreeNav({ index, currentId }: { index: TreeIndex; currentId: string | null }) {
  const pathIds = index.path(currentId).map((folder) => folder.id)
  const [open, setOpen] = useState(() => new Set(pathIds))
  // Opening another folder unfolds the path to it, without folding what the user opened.
  const [seen, setSeen] = useState(currentId)
  if (seen !== currentId) {
    setSeen(currentId)
    setOpen((previous) => new Set([...previous, ...pathIds]))
  }
  const toggle = (id: string) => setOpen((previous) => (previous.has(id) ? new Set([...previous].filter((x) => x !== id)) : new Set(previous).add(id)))
  const itemClass = 'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-accent aria-[current=page]:font-medium'

  const branch = (parentId: string | null) => (
    <ul className="flex flex-col">
      {index.subfolders.get(parentId)?.map((folder) => {
        const expanded = open.has(folder.id)
        return (
          <li key={folder.id}>
            <div className="flex items-center">
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={`${expanded ? 'Replier' : 'Déplier'} ${folder.name}`}
                onClick={() => toggle(folder.id)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <ChevronRightIcon className={cn('size-4 transition-transform', expanded && 'rotate-90')} aria-hidden="true" />
              </button>
              <Link to={folderHref(folder.id)} aria-current={folder.id === currentId ? 'page' : undefined} className={itemClass}>
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate">{folder.name}</span>
              </Link>
            </div>
            {expanded && <div className="ml-3.5 border-l pl-1.5">{branch(folder.id)}</div>}
          </li>
        )
      })}
      {index.notesIn.get(parentId)?.map((note) => (
        <li key={note.id} className="flex pl-8">
          <Link to={noteHref(note.id)} className={itemClass}>
            <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{note.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  )

  return (
    <>
      <Link to="/annexes" aria-current={currentId === null ? 'page' : undefined} className={cn(itemClass, 'mb-1 w-full')}>
        <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        Annexes
      </Link>
      {branch(null)}
    </>
  )
}

function Breadcrumb({ index, currentId }: { index: TreeIndex; currentId: string | null }) {
  const path = index.path(currentId)
  return (
    <nav aria-label="Fil d'Ariane">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <li>
          {path.length ? <Link to="/annexes" className={rowLink}>Annexes</Link> : <h2 aria-current="page" className="text-lg font-semibold text-foreground">Annexes</h2>}
        </li>
        {path.map((folder, i) => (
          <li key={folder.id} className="flex items-center gap-1.5">
            <ChevronRightIcon className="size-3.5" aria-hidden="true" />
            {i === path.length - 1 ? (
              <h2 aria-current="page" className="text-lg font-semibold text-foreground">{folder.name}</h2>
            ) : (
              <Link to={folderHref(folder.id)} className={rowLink}>{folder.name}</Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}

function FolderContent({ index, folderId, isAdmin, onAction }: { index: TreeIndex; folderId: string | null; isAdmin: boolean; onAction: (dialog: Dialog) => void }) {
  const folders = index.subfolders.get(folderId) ?? []
  const notes = index.notesIn.get(folderId) ?? []
  if (!folders.length && !notes.length)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>{folderId ? 'Dossier vide' : 'Aucune annexe'}</EmptyTitle>
          <EmptyDescription>{isAdmin ? 'Créez un dossier ou une note avec les boutons ci-dessus.' : "L'administrateur n'a encore rien ajouté ici."}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {folders.map((folder) => (
        <li key={folder.id} className="flex items-center gap-2 p-3">
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <Link to={folderHref(folder.id)} className={cn(rowLink, 'font-medium')}>
            {folder.name}
          </Link>
        </li>
      ))}
      {notes.map((note) => (
        <li key={note.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-3">
          <div className="flex min-w-0 max-w-prose flex-1 flex-col gap-1">
            <span className="flex items-center gap-2">
              <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Link to={noteHref(note.id)} className={cn(rowLink, 'font-medium')}>
                {note.title}
              </Link>
            </span>
            {note.excerpt && <p className="line-clamp-2 text-sm text-pretty text-muted-foreground">{note.excerpt}</p>}
            <p className="text-xs text-muted-foreground tabular-nums">Modifiée le {shortDay.format(new Date(note.updated_at))}</p>
          </div>
          {isAdmin && (
            <div className="flex gap-1">
              <Button variant="ghost" onClick={() => onAction({ kind: 'move', target: { kind: 'note', note } })} aria-label={`Déplacer ${note.title}`}>
                <FolderInputIcon data-icon="inline-start" />
                Déplacer
              </Button>
              <Button variant="ghost" onClick={() => onAction({ kind: 'delete', target: { kind: 'note', note } })} aria-label={`Supprimer ${note.title}`}>
                <Trash2Icon data-icon="inline-start" />
                Supprimer
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function SearchResults({ results, index }: { results: ReturnType<typeof useAnnexSearch>; index: TreeIndex }) {
  if (results.isPending) return <Skeleton className="h-32 w-full" aria-busy="true" aria-label="Recherche en cours" />
  if (results.isError)
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>Recherche indisponible</AlertTitle>
        <AlertDescription>{results.error.message}</AlertDescription>
      </Alert>
    )
  if (!results.data.length)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>Aucune annexe trouvée</EmptyTitle>
          <EmptyDescription>Essayez un autre mot, ou videz la recherche.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {results.data.map((note: NoteItem) => (
        <li key={note.id} className="flex flex-col gap-1 p-3">
          <Link to={noteHref(note.id)} className={cn(rowLink, 'w-fit font-medium')}>
            {note.title}
          </Link>
          <p className="text-xs text-muted-foreground">{pathLabel(index, note.folder_id)}</p>
          {note.excerpt && <p className="line-clamp-2 text-sm text-pretty text-muted-foreground">{note.excerpt}</p>}
        </li>
      ))}
    </ul>
  )
}
