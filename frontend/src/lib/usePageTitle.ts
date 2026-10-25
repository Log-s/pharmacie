import { useEffect } from 'react'

/** One document title per screen (WCAG 2.4.2): « Page – Interventions pharmaceutiques », as on the login page. */
export function usePageTitle(page: string) {
  useEffect(() => {
    document.title = `${page} – Interventions pharmaceutiques`
  }, [page])
}
