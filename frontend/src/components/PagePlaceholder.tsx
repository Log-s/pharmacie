import { ConstructionIcon } from 'lucide-react'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { PageHeader } from '@/components/PageHeader'

/** Stand-in body for a module page whose unit has not landed yet (see DESIGN.md, route table). */
export function PagePlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ConstructionIcon />
          </EmptyMedia>
          <EmptyTitle>Bientôt disponible</EmptyTitle>
          <EmptyDescription>Cet écran arrive dans une prochaine version de l'application.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  )
}
