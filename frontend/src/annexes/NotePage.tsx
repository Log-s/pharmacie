import { ChevronRightIcon, PencilIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { StatusPage } from '@/components/StatusPage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/auth/session'
import { ApiError } from '@/lib/api'
import { indexTree, useAnnexTree, useNote } from '@/annexes/api'

const shortDay = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' })
const crumb = 'rounded-md outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50'

/** `/annexes/notes/:id` for both roles: the note and its folder path; the admin gets « Modifier ». */
export default function NotePage() {
  const { id = '' } = useParams()
  const isAdmin = useMe().data?.role === 'admin'
  const note = useNote(id)
  const tree = useAnnexTree()
  const path = useMemo(() => (tree.data && note.data ? indexTree(tree.data).path(note.data.folder_id) : []), [tree.data, note.data])

  if (note.isPending) return <Skeleton className="h-64 w-full max-w-3xl" aria-busy="true" aria-label="Chargement de la note…" />
  if (note.isError)
    return note.error instanceof ApiError && note.error.status === 404 ? (
      <StatusPage title="Note introuvable" description="Cette note n'existe pas ou a été supprimée." />
    ) : (
      <Alert variant="destructive" role="alert">
        <AlertTitle>Note indisponible</AlertTitle>
        <AlertDescription>{note.error.message}</AlertDescription>
      </Alert>
    )

  return (
    <>
      <nav aria-label="Fil d'Ariane" className="mb-3">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          <li>
            <Link to="/annexes" className={crumb}>Annexes</Link>
          </li>
          {path.map((folder) => (
            <li key={folder.id} className="flex min-w-0 items-center gap-1.5">
              <ChevronRightIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <Link to={`/annexes?dossier=${folder.id}`} className={`${crumb} truncate`}>{folder.name}</Link>
            </li>
          ))}
        </ol>
      </nav>
      <PageHeader
        title={note.data.title}
        description={`Modifiée le ${shortDay.format(new Date(note.data.updated_at))}`}
        actions={
          isAdmin && (
            <Button asChild>
              <Link to={`/annexes/notes/${id}/modifier`}>
                <PencilIcon data-icon="inline-start" />
                Modifier
              </Link>
            </Button>
          )
        }
      />
      {/* dangerouslySetInnerHTML is acceptable only because the server sanitises body_html with nh3 on every write. */}
      <article className="note-content max-w-3xl rounded-xl border bg-card p-4 md:p-6" dangerouslySetInnerHTML={{ __html: note.data.body_html }} />
    </>
  )
}
