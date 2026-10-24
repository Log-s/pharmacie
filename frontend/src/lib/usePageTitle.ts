import { useEffect } from 'react'

/** One document title per screen (WCAG 2.4.2): « Page – Fiches de la pharmacie », as on the login page. */
export function usePageTitle(page: string) {
  useEffect(() => {
    document.title = `${page} – Fiches de la pharmacie`
  }, [page])
}
