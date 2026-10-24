import { InfoIcon } from 'lucide-react'
import { useId } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { ApiError } from '@/lib/api'
import { annexFileUrl, useAnnex } from '@/annexes/api'

export type AnnexInfoProps = {
  /** `annex_ref.annex_id` of the template node. */
  annexId: string
  /** Visible label of the field, used for the accessible name (« Annexe : <label> »). */
  label?: string
}

const iconClass =
  'ml-1 inline-flex size-6 items-center justify-center rounded-full align-middle text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4'

/**
 * "i" icon after a field label: hover or keyboard focus shows the annex excerpt, click opens the
 * PDF in a new tab. A deleted annex (404) shows « Annexe supprimée » and no link.
 */
export function AnnexInfo({ annexId, label }: AnnexInfoProps) {
  const annex = useAnnex(annexId)
  const cardId = useId()
  const name = label ? `Annexe : ${label}` : 'Annexe'

  if (annex.error instanceof ApiError && annex.error.status === 404) {
    return <span className="ml-1 align-middle text-xs text-muted-foreground italic">Annexe supprimée</span>
  }
  const link = (
    <a href={annexFileUrl(annexId)} target="_blank" rel="noopener" aria-label={name} aria-describedby={annex.data ? cardId : undefined} className={iconClass}>
      <InfoIcon aria-hidden="true" />
    </a>
  )
  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>{link}</HoverCardTrigger>
      {annex.data && (
        <HoverCardContent id={cardId} role="tooltip" align="start" className="w-80">
          <a href={annexFileUrl(annexId)} target="_blank" rel="noopener" tabIndex={-1} className="flex flex-col gap-1 rounded-md outline-none">
            <span className="font-medium">{annex.data.title}</span>
            <span className="line-clamp-6 text-muted-foreground">{annex.data.excerpt || 'Aucun extrait disponible pour ce document.'}</span>
            <span className="text-xs text-primary underline underline-offset-2">Ouvrir le PDF dans un nouvel onglet</span>
          </a>
        </HoverCardContent>
      )}
    </HoverCard>
  )
}
