import { LogOutIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Brand } from '@/components/Brand'
import { navItems } from '@/components/nav'
import { ProfileSwitcher } from '@/components/ProfileSwitcher'
import { ThemeToggle } from '@/components/ThemeToggle'
import { Button } from '@/components/ui/button'
import { useLogout, useMe } from '@/auth/session'

const focusRing = 'outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/** App shell: header (brand, nav, profile slot, theme, logout) around the routed page. */
export default function App() {
  const me = useMe().data
  const logout = useLogout()
  // A client-side navigation moves focus to the page, as a full page load would (keyboard and screen readers).
  const { pathname } = useLocation()
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) first.current = false
    else main.current?.focus({ preventScroll: true })
  }, [pathname])
  if (!me) return null // RequireAuth redirects; this covers the render right after logout
  // The user account sees no navigation until it has picked a profile.
  const items = me.role === 'admin' || me.active_profile ? navItems.filter((item) => item.roles.includes(me.role)) : []

  return (
    <div className="flex min-h-svh flex-col">
      <a
        href="#contenu"
        className={`sr-only rounded-md bg-background px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:top-2 focus:left-2 ${focusRing}`}
      >
        Aller au contenu
      </a>
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 px-4 md:px-6">
          <Link to="/" className={`flex h-14 items-center rounded-md ${focusRing}`} aria-label="Interventions pharmaceutiques, accueil">
            <Brand />
          </Link>
          {items.length > 0 && (
            <nav aria-label="Navigation principale" className="order-last -mx-1 w-full overflow-x-auto lg:order-none lg:mx-0 lg:w-auto">
              <ul className="flex">
                {items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={`relative flex h-11 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full aria-[current=page]:after:bg-primary lg:h-14 ${focusRing}`}
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          )}
          <div className="ml-auto flex h-14 items-center gap-2">
            {me.role === 'user' ? (
              <ProfileSwitcher />
            ) : (
              <span className="text-sm text-muted-foreground">Administrateur</span>
            )}
            <ThemeToggle />
            <Button
              variant="ghost"
              disabled={logout.isPending}
              onClick={() => logout.mutate()}
            >
              <LogOutIcon data-icon="inline-start" />
              Se déconnecter
            </Button>
          </div>
        </div>
      </header>
      <main id="contenu" ref={main} tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 outline-none md:px-6">
        <Outlet />
      </main>
    </div>
  )
}
