/** The officine's green cross next to the product name. Decorative: the name carries the meaning. */
export function Brand() {
  return (
    <span className="flex items-center gap-2 font-semibold tracking-tight">
      <svg viewBox="0 0 16 16" className="size-5 text-primary" aria-hidden="true">
        <path fill="currentColor" d="M5.5 1h5v4.5H15v5h-4.5V15h-5v-4.5H1v-5h4.5z" />
      </svg>
      Fiches de la pharmacie
    </span>
  )
}
