import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { useMe } from '@/auth/session'

/**
 * Header slot of the user account (spec §2.2). Placeholder until U10 replaces this file with the
 * real switcher (change profile without password); keep the export name, App.tsx renders it.
 */
export function ProfileSwitcher() {
  const profile = useMe().data?.active_profile
  if (!profile) return null
  return (
    <div className="flex items-center gap-2" data-slot="profile-switcher">
      <Paraphe initials={profile.initials} color={profile.color} />
      <span className="max-w-40 truncate text-sm font-medium">{profile.display_name}</span>
      <Button variant="ghost" size="sm" asChild>
        <Link to="/profil">Changer de profil</Link>
      </Button>
    </div>
  )
}

/** A profile's initials stamped in its color, like a paraphe in a register (see DESIGN.md). */
export function Paraphe({ initials, color }: { initials: string; color: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-7 shrink-0 items-center justify-center rounded-md border-2 text-xs font-semibold tabular-nums"
      style={{ borderColor: color, backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` }}
    >
      {initials}
    </span>
  )
}
