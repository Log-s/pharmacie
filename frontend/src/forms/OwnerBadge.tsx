import { Paraphe } from '@/components/ProfileSwitcher'
import type { Owner } from './api'

/** The owner profile as a paraphe + name; a profile deleted while it still has fiches is archived. */
export function OwnerBadge({ owner }: { owner: Owner }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Paraphe number={owner.number} color={owner.color} />
      <span>
        {owner.display_name}
        {owner.archived && <span className="text-muted-foreground"> (profil supprimé)</span>}
      </span>
    </span>
  )
}
