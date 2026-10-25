import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { TemplateTree } from '@/templates/schema'

// U5 admin endpoints (docs/dev/modules.md, "U5: Templates API").
export type TemplateSummary = { id: string; name: string; archived_at: string | null; latest_version: number | null }
export type TemplateVersion = { id: string; template_id: string; version: number; published_at: string; schema_json: TemplateTree }
export type TemplateDetail = TemplateSummary & { versions: TemplateVersion[] }
export type Annex = { id: string; title: string; filename: string; size: number; excerpt: string; created_at: string }

export const templatesKey = ['templates'] as const

export const useTemplates = () => useQuery({ queryKey: templatesKey, queryFn: () => api<TemplateSummary[]>('/templates') })

export const useTemplate = (id: string) =>
  useQuery({ queryKey: [...templatesKey, id], queryFn: () => api<TemplateDetail>(`/templates/${id}`) })
