import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { usePageTitle } from '@/lib/usePageTitle'

/** Full-page message: 403, 404, server unreachable. */
export function StatusPage({ title, description }: { title: string; description: string }) {
  usePageTitle(title)
  return (
    <Empty className="py-16">
      <EmptyHeader>
        <EmptyTitle>
          <h1 className="text-xl font-semibold">{title}</h1>
        </EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" asChild>
          <Link to="/">Retour à l'accueil</Link>
        </Button>
      </EmptyContent>
    </Empty>
  )
}
