import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon, DownloadIcon } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { useMe } from '@/auth/session'
import { PageHeader } from '@/components/PageHeader'
import { StatusPage } from '@/components/StatusPage'
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { FormRenderer } from '@/forms/renderer'
import { api, ApiError, queryClient } from '@/lib/api'
import { cn } from '@/lib/utils'
import { downloadPdf, formsKey, type FormOut } from './api'
import { OwnerBadge } from './OwnerBadge'

/** `/fiches/:formId`: read-only view. Modifier / Supprimer come from the server's `can_edit` (owner with active profile, or admin). */
export default function FormViewPage() {
  const { formId = '' } = useParams()
  const navigate = useNavigate()
  const activeProfileId = useMe().data?.active_profile?.id
  const form = useQuery({ queryKey: [...formsKey, formId], queryFn: () => api<FormOut>(`/forms/${formId}`) })
  const exportPdf = useMutation({
    mutationFn: downloadPdf,
    onSuccess: (_, sent) => toast.success(`${sent.reference}.pdf téléchargé.`),
    onError: (error) => toast.error(error.message),
  })
  const remove = useMutation({
    mutationFn: () => api(`/forms/${formId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success(`Fiche ${form.data?.reference} supprimée.`)
      // Dropped, not just marked stale: the list must not flash the deleted fiche while it refetches.
      queryClient.removeQueries({ queryKey: [...formsKey, 'list'] })
      navigate('/fiches')
    },
    onError: (error) => toast.error(error.message),
  })

  if (form.isPending) return <Skeleton className="h-64 w-full max-w-2xl" aria-busy="true" aria-label="Chargement de la fiche…" />
  if (form.isError)
    return form.error instanceof ApiError && form.error.status === 404 ? (
      <StatusPage title="Fiche introuvable" description="Cette fiche n'existe pas ou a été supprimée." />
    ) : (
      <Alert variant="destructive" role="alert">
        <AlertTitle>Fiche indisponible</AlertTitle>
        <AlertDescription>{form.error.message}</AlertDescription>
      </Alert>
    )

  const fiche = form.data
  return (
    <>
      <p className="-mt-2 mb-3">
        <Link to="/fiches" className={cn(buttonVariants({ variant: 'ghost' }), '-ml-2.5')}>
          <ArrowLeftIcon data-icon="inline-start" />
          Toutes les fiches
        </Link>
      </p>
      <PageHeader
        title={fiche.reference}
        description={`${fiche.template_name}, version ${fiche.version}.`}
        actions={
          <>
            <Button variant="outline" size="lg" disabled={exportPdf.isPending} onClick={() => exportPdf.mutate(fiche)}>
              {exportPdf.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <DownloadIcon data-icon="inline-start" />}
              Exporter en PDF
            </Button>
            {fiche.can_edit && (
              <>
                <Link to={`/fiches/${fiche.id}/modifier`} className={buttonVariants({ variant: 'outline', size: 'lg' })}>
                  Modifier
                </Link>
                <AlertDialog>
                  <AlertDialogTrigger className={buttonVariants({ variant: 'destructive', size: 'lg' })} disabled={remove.isPending}>
                    Supprimer
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Supprimer la fiche {fiche.reference}&nbsp;?</AlertDialogTitle>
                      <AlertDialogDescription>La suppression est définitive : la fiche et ses réponses ne pourront pas être récupérées.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => remove.mutate()}>
                        Supprimer définitivement
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
          </>
        }
      />
      <div className="flex max-w-2xl flex-col gap-4">
        {fiche.owner.id !== activeProfileId && (
          <p className="flex items-center gap-2 text-sm" data-testid="fiche-de">
            Fiche de <OwnerBadge owner={fiche.owner} />
            {!fiche.can_edit && <Badge variant="secondary">Lecture seule</Badge>}
          </p>
        )}
        <Card>
          <CardContent>
            <FormRenderer tree={fiche.schema_json} mode="readonly" defaultValue={{ reference: fiche.reference, data: fiche.data }} />
          </CardContent>
        </Card>
      </div>
    </>
  )
}
