import { ApiError, meQueryKey, queryClient } from '@/lib/api'
import type { FormValue } from '@/forms/renderer'
import type { TemplateTree } from '@/templates/schema'

export type Owner = { id: string; display_name: string; initials: string; color: string; archived: boolean }
/** U7 `FormSummary`; `can_edit` is decided by the server (owner with active profile, or admin). */
export type FormSummary = {
  id: string
  reference: string
  template_id: string
  template_name: string
  template_version_id: string
  version: number
  owner: Owner
  created_at: string
  updated_at: string
  can_edit: boolean
}
export type FormOut = FormSummary & { data: FormValue['data']; schema_json: TemplateTree }
export type FormsPage = { items: FormSummary[]; total: number; page: number; page_size: number }

export const formsKey = ['forms'] as const

/** `GET /api/forms/{id}/pdf` saved as `<reference>.pdf` (the API call is kept, rather than a bare link, to report failures). */
export async function downloadPdf(form: Pick<FormSummary, 'id' | 'reference'>) {
  let response: Response
  try {
    response = await fetch(`/api/forms/${form.id}/pdf`, { credentials: 'same-origin' })
  } catch {
    throw new ApiError(0, 'Serveur injoignable : vérifiez la connexion puis réessayez.')
  }
  if (!response.ok) {
    if (response.status === 401) queryClient.setQueryData(meQueryKey, null)
    const body = await response.json().catch(() => null)
    throw new ApiError(response.status, typeof body?.detail === 'string' ? body.detail : "L'export en PDF a échoué. Réessayez.")
  }
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = `${form.reference}.pdf`
  link.click()
  URL.revokeObjectURL(url)
}
