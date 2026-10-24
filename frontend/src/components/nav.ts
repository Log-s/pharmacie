import type { Role } from '@/auth/session'

/** Header navigation per role (spec §2.1). Each `to` is a route of router.tsx. */
export const navItems: { to: string; label: string; roles: Role[] }[] = [
  { to: '/fiches', label: 'Fiches', roles: ['admin', 'user'] },
  { to: '/profils', label: 'Profils', roles: ['admin'] },
  { to: '/templates', label: 'Templates', roles: ['admin'] },
  { to: '/annexes', label: 'Annexes', roles: ['admin', 'user'] },
  { to: '/journal', label: 'Journal', roles: ['admin'] },
  { to: '/compte-utilisateur', label: 'Compte utilisateur', roles: ['admin'] },
]
