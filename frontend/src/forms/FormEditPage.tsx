import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router'
import { PageHeader } from '@/components/PageHeader'
import { StatusPage } from '@/components/StatusPage'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { api, ApiError } from '@/lib/api'
import { FormEditor } from './FormEditor'
import { formsKey, type FormOut } from './api'

/** `/fiches/:formId/modifier`: owner (active profile) or admin. Anyone else is sent back to the read-only view. */
export default function FormEditPage() {
  const { formId = '' } = useParams()
  const form = useQuery({ queryKey: [...formsKey, formId], queryFn: () => api<FormOut>(`/forms/${formId}`) })

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
  if (!form.data.can_edit) return <Navigate to={`/fiches/${formId}`} replace />

  return (
    <>
      <PageHeader title={`Modifier ${form.data.reference}`} description={`${form.data.template_name}, version ${form.data.version}.`} />
      <div className="max-w-2xl">
        <FormEditor
          key={form.data.id}
          tree={form.data.schema_json}
          defaultValue={{ reference: form.data.reference, data: form.data.data }}
          cancelTo={`/fiches/${formId}`}
          save={(value) => api<FormOut>(`/forms/${formId}`, { method: 'PUT', json: value })}
        />
      </div>
    </>
  )
}
