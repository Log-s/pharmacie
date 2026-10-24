import { useQuery } from '@tanstack/react-query'
import { ChevronRightIcon } from 'lucide-react'
import { Link, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { api } from '@/lib/api'
import type { TemplateTree } from '@/templates/schema'
import { FormEditor } from './FormEditor'
import { formsKey, type FormOut } from './api'

type Available = { id: string; name: string; version: { id: string; version: number; schema_json: TemplateTree } }

/** `/fiches/nouvelle`: pick a template (kept in `?template=`), then fill the fiche. */
export default function FormNewPage() {
  const [search] = useSearchParams()
  const templates = useQuery({ queryKey: [...formsKey, 'templates'], queryFn: () => api<Available[]>('/templates/available') })
  const chosen = templates.data?.find((t) => t.id === search.get('template'))

  return (
    <>
      <PageHeader
        title="Nouvelle fiche"
        description={chosen ? `${chosen.name}, version ${chosen.version.version}. La référence est proposée automatiquement.` : 'Choisissez le template à remplir.'}
      />
      <div className="max-w-2xl">
        {templates.isPending && <Skeleton className="h-32 w-full" aria-busy="true" aria-label="Chargement des templates…" />}
        {templates.isError && (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Templates indisponibles</AlertTitle>
            <AlertDescription>{templates.error.message}</AlertDescription>
          </Alert>
        )}
        {templates.data?.length === 0 && (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>Aucun template disponible</EmptyTitle>
              <EmptyDescription>L'administrateur doit d'abord publier un template pour que des fiches puissent être créées.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        {templates.data && templates.data.length > 0 && !chosen && (
          <nav aria-label="Templates disponibles">
            <ul className="flex flex-col divide-y rounded-xl border">
              {templates.data.map((template) => (
                <li key={template.id}>
                  <Link
                    to={`?template=${template.id}`}
                    className="flex min-h-12 items-center justify-between gap-4 px-4 py-3 outline-none first:rounded-t-xl last:rounded-b-xl hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <span className="font-medium">{template.name}</span>
                    <span className="flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
                      version {template.version.version}
                      <ChevronRightIcon aria-hidden="true" className="size-4" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
      {chosen && (
        <div className="max-w-2xl">
          <p className="-mt-3 mb-5">
            <Link to="?" className={cn(buttonVariants({ variant: 'link' }), 'h-auto p-0')}>
              Changer de template
            </Link>
          </p>
          <FormEditor
            key={chosen.id}
            tree={chosen.version.schema_json}
            cancelTo="/fiches"
            save={(value) => api<FormOut>('/forms', { method: 'POST', json: { template_version_id: chosen.version.id, ...value } })}
          />
        </div>
      )}
    </>
  )
}
