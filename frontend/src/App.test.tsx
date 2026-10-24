import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { toast } from 'sonner'
import { type Me, session } from '@/auth/session'
import { api, meQueryKey, queryClient } from '@/lib/api'
import { routes } from '@/router'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const admin: Me = { role: 'admin', active_profile: null, csrf_token: 'csrf-admin' }
const profile = { id: 'p1', display_name: 'Claire Martin', initials: 'CM', color: '#2f855a' }
const user: Me = { role: 'user', active_profile: profile, csrf_token: 'csrf-user' }
const userNoProfile: Me = { ...user, active_profile: null }

function renderAt(path: string, me: Me | null) {
  queryClient.setQueryData(meQueryKey, me)
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

const navLinks = () =>
  within(screen.getByRole('navigation', { name: 'Navigation principale' }))
    .getAllByRole('link')
    .map((link) => link.textContent)

afterEach(() => {
  session.loggedOut = false
  queryClient.clear()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('role guards and navigation', () => {
  test('anonymous visitor is sent to the login page', () => {
    renderAt('/fiches', null)
    expect(screen.getByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
  })

  test('admin nav: Fiches, Profils, Templates, Annexes, Journal, Compte utilisateur', () => {
    renderAt('/fiches', admin)
    expect(navLinks()).toEqual(['Fiches', 'Profils', 'Templates', 'Annexes', 'Journal', 'Compte utilisateur'])
    expect(screen.getByRole('heading', { level: 1, name: 'Fiches' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Fiches' })).toHaveAttribute('aria-current', 'page')
  })

  test('user nav: Fiches, Annexes and the profile switcher slot', () => {
    renderAt('/annexes', user)
    expect(navLinks()).toEqual(['Fiches', 'Annexes'])
    expect(screen.getByText('Claire Martin')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Changer de profil/ })).toBeInTheDocument()
  })

  test('user without an active profile is sent to the profile picker, without nav', () => {
    const router = renderAt('/fiches', userNoProfile)
    expect(router.state.location.pathname).toBe('/profil')
    expect(screen.getByRole('heading', { level: 1, name: 'Choix du profil' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  test.each(['/profils', '/templates', '/templates/nouveau', '/journal', '/compte-utilisateur'])(
    'user gets a 403 page on admin route %s',
    (path) => {
      renderAt(path, user)
      expect(screen.getByRole('heading', { name: 'Accès refusé' })).toBeInTheDocument()
    },
  )

  test.each(['/profil', '/fiches/nouvelle'])('admin gets a 403 page on user route %s', (path) => {
    renderAt(path, admin)
    expect(screen.getByRole('heading', { name: 'Accès refusé' })).toBeInTheDocument()
  })

  test('unknown path shows the 404 page', () => {
    renderAt('/nulle-part', admin)
    expect(screen.getByRole('heading', { name: 'Page introuvable' })).toBeInTheDocument()
  })

  test('logout returns to the login page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const router = renderAt('/fiches', admin)
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }))
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.state).toBeNull())
    expect(router.state.location.pathname).toBe('/connexion')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/auth/logout')
    expect(queryClient.getQueryData(meQueryKey)).toBeNull()
  })

  test('a 401 from any API call during the session redirects to the login page', async () => {
    renderAt('/journal', admin)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: 'Session expirée' }, { status: 401 })))
    await act(() => api('/journal').catch(() => undefined))
    expect(await screen.findByRole('heading', { name: 'Connexion' })).toBeInTheDocument()
  })
})

describe('login page', () => {
  test('wrong password shows the French error; success opens the app', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ detail: 'Mot de passe incorrect.' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json(admin))
    vi.stubGlobal('fetch', fetchMock)
    const router = renderAt('/connexion', null)
    fireEvent.click(screen.getByRole('radio', { name: 'Administrateur' }))
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'mauvais-mot-de-passe' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByText('Mot de passe incorrect.')).toBeInTheDocument()
    expect(screen.getByLabelText('Mot de passe')).toHaveAttribute('aria-invalid', 'true')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ role: 'admin', password: 'mauvais-mot-de-passe' })

    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'le-bon-mot-de-passe' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Fiches' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/fiches')
  })

  test('lockout (423) shows the lock message', async () => {
    const detail = 'Compte verrouillé après plusieurs échecs de connexion. Réessayez dans 1 minute.'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail }, { status: 423 })))
    renderAt('/connexion', null)
    fireEvent.change(screen.getByLabelText('Mot de passe'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Se connecter' }))
    expect(await screen.findByText('Compte verrouillé')).toBeInTheDocument()
    expect(screen.getByText(detail)).toBeInTheDocument()
  })
})

describe('Compte utilisateur page', () => {
  async function fill(password: string, confirm = password) {
    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: password } })
    fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: confirm } })
    fireEvent.click(screen.getByRole('button', { name: 'Définir le mot de passe' }))
  }

  test('too short or mismatched passwords are refused before any request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/compte-utilisateur', admin)
    await fill('court', 'autre')
    expect(screen.getByText('Le mot de passe doit contenir au moins 12 caractères.')).toBeInTheDocument()
    expect(screen.getByText(/Les deux saisies ne correspondent pas/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('shows the server strength verdict (422), then saves a strong password', async () => {
    const weak = 'Mot de passe trop facile à deviner : allongez-le ou combinez plusieurs mots sans rapport entre eux.'
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ detail: weak }, { status: 422 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    renderAt('/compte-utilisateur', admin)
    await fill('aaaaaaaaaaaa')
    expect(await screen.findByText(weak)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Nouveau mot de passe'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Confirmation'), { target: { value: '' } })
    await fill('cheval-agrafe-boussole-71')
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('/api/admin/user-password')
    expect(init.headers['X-CSRF-Token']).toBe('csrf-admin')
    expect(JSON.parse(init.body)).toEqual({ password: 'cheval-agrafe-boussole-71' })
  })
})
