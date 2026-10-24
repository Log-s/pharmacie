// Contract stub (foreman): U10 implements the real component (HoverCard/Tooltip with the excerpt on
// hover AND keyboard focus, click opens the PDF in a new tab, « Annexe supprimée » fallback).
// U11's renderer only imports it. Keep this signature stable.
export type AnnexInfoProps = {
  /** `annex_ref.annex_id` of the template node. */
  annexId: string
  /** Visible label of the field, used for the accessible name (« Annexe : <label> »). */
  label?: string
}

export function AnnexInfo({ annexId, label }: AnnexInfoProps) {
  return (
    <a
      href={`/api/annexes/${annexId}/file`}
      target="_blank"
      rel="noopener"
      aria-label={label ? `Annexe : ${label}` : 'Annexe'}
      className="ml-1 inline-flex size-4 items-center justify-center rounded-full border text-[10px] font-semibold"
    >
      i
    </a>
  )
}
