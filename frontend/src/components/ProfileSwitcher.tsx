import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from 'cn'
import { toast } from 'sonner'
import { buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useMe } from '@/auth/session'
import { useProfiles, useSwitchProfile } from '@/profiles/api'

/** Header selector of the user account (spec §2.2): changes the active profile, no password. */
export function ProfileSwitcher() {
  const profile = useMe().data?.active_profile
  const [open, setOpen] = useState(false)
  const profiles = useProfiles({ enabled: open })
  const switchProfile = useSwitchProfile()
  if (!profile) return null

  const choose = (id: string) => {
    if (id === profile.id) return
    switchProfile.mutate(id, {
      onSuccess: (me) => toast.success(`Profil actif : ${me.active_profile?.display_name ?? ''}`),
      onError: (error) => toast.error(error.message),
    })
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {/* A native button: shadcn's Button does not forward `ref` under React 18, which Popper needs. */}
        <button type="button" className={buttonVariants({ variant: 'ghost', className: 'h-9 gap-2 px-2' })} aria-label={`Profil actif : ${profile.display_name}. Changer de profil`}>
          <Paraphe number={profile.number} color={profile.color} />
          <span className="max-w-40 truncate text-sm font-medium">{profile.display_name}</span>
          <ChevronDownIcon data-icon="inline-end" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>Changer de profil</DropdownMenuLabel>
        {profiles.isPending && <p className="px-2 py-1.5 text-sm text-muted-foreground">Chargement…</p>}
        {profiles.isError && <p role="alert" className="px-2 py-1.5 text-sm text-destructive">{profiles.error.message}</p>}
        {profiles.data && (
          <DropdownMenuRadioGroup value={profile.id} onValueChange={choose}>
            {profiles.data.map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id} className="gap-2">
                <Paraphe number={p.number} color={p.color} />
                <span className="truncate">{p.display_name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A profile number stamped in its color, like a paraphe in a register (see DESIGN.md). */
export function Paraphe({ number, color, className }: { number: number | string; color: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn('flex size-7 shrink-0 items-center justify-center rounded-md border-2 text-xs font-semibold tabular-nums', String(number).length > 2 && 'text-[11px] tracking-tight', className)}
      style={{ borderColor: color, backgroundColor: `color-mix(in oklch, ${color} 14%, transparent)` }}
    >
      {number}
    </span>
  )
}
