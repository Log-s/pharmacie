import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { toast } from 'sonner'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import type { Me } from '@/auth/session'
import { ProfileSwitcher } from '@/components/ProfileSwitcher'
import { meQueryKey, queryClient } from '@/lib/api'
import ProfilePickerPage from '@/profiles/ProfilePickerPage'
import ProfilesPage from '@/profiles/ProfilesPage'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const claire = { id: 'p1', display_name: 'Claire Martin', number: 1, color: '#2f855a', archived_at: null }
const paul = { id: 'p2', display_name: 'Paul Durand', number: 3, color: '#2b6cb0', archived_at: null }
const old = { id: 'p3', display_name: 'Ancien', number: 2, color: '#4a5568', archived_at: '2026-01-01T00:00:00Z' }
const userMe = (active: typeof claire | null): Me => ({ role: 'user', active_profile: active, csrf_token: 'csrf-user' })
const adminMe: Me = { role: 'admin', active_profile: null, csrf_token: 'csrf-admin' }

/** fetch stub routing on "METHOD path"; every call is recorded in `calls`. */
function stubApi(routes: Record<string, () => Response>) {
  const calls: { key: string; body?: unknown; csrf?: string }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit & { headers: Record<string, string> } = { headers: {} }) => {
      const key = `${init.method ?? 'GET'} ${url.replace('/api', '')}`
      calls.push({ key, body: init.body ? JSON.parse(init.body as string) : undefined, csrf: init.headers['X-CSRF-Token'] })
      const route = routes[key]
      if (!route) throw new Error(`unexpected request ${key}`)
      return route()
    }),
  )
  return calls
}

const renderWithQuery = (ui: React.ReactNode, path = '/') =>
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter([{ path: '*', element: ui }, { path: '/fiches', element: <p>Liste des fiches</p> }], { initialEntries: [path] })} />
    </QueryClientProvider>,
  )

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  vi.clearAllMocks()
})

describe('profile picker', () => {
  test('lists the active profiles as keyboard-accessible buttons and posts the choice', async () => {
    queryClient.setQueryData(meQueryKey, userMe(null))
    const calls = stubApi({
      'GET /profiles': () => Response.json([claire, paul]),
      'POST /session/profile': () => Response.json(userMe(paul)),
    })
    renderWithQuery(<ProfilePickerPage />, '/profil')
    const cards = await screen.findAllByRole('button')
    expect(cards.map((c) => c.textContent)).toEqual(['1Claire Martin', '3Paul Durand'])
    expect(calls[0].key).toBe('GET /profiles') // no include_archived for the picker
    cards[1].focus()
    expect(cards[1]).toHaveFocus() // native buttons: Tab/Enter/Space work
    fireEvent.click(cards[1])
    expect(await screen.findByText('Liste des fiches')).toBeInTheDocument()
    const post = calls.find((c) => c.key === 'POST /session/profile')!
    expect(post.body).toEqual({ profile_id: 'p2' })
    expect(post.csrf).toBe('csrf-user')
    expect(queryClient.getQueryData<Me>(meQueryKey)?.active_profile?.id).toBe('p2')
  })

  test('shows an empty state without profile', async () => {
    queryClient.setQueryData(meQueryKey, userMe(null))
    stubApi({ 'GET /profiles': () => Response.json([]) })
    renderWithQuery(<ProfilePickerPage />)
    expect(await screen.findByText('Aucun profil disponible')).toBeInTheDocument()
  })
})

describe('header profile switcher', () => {
  test('changes profile without a password and invalidates every query', async () => {
    queryClient.setQueryData(meQueryKey, userMe(claire))
    queryClient.setQueryData(['forms'], { items: [] })
    const calls = stubApi({
      'GET /profiles': () => Response.json([claire, paul]),
      'POST /session/profile': () => Response.json(userMe(paul)),
      'GET /auth/me': () => Response.json(userMe(paul)),
    })
    renderWithQuery(<ProfileSwitcher />)
    const trigger = screen.getByRole('button', { name: /Changer de profil/ })
    expect(trigger).toHaveTextContent('Claire Martin')
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Paul Durand' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Profil actif\u00a0: Paul Durand'))
    const post = calls.find((c) => c.key === 'POST /session/profile')!
    expect(post.body).toEqual({ profile_id: 'p2' }) // no password field anywhere
    expect(queryClient.getQueryState(['forms'])?.isInvalidated).toBe(true)
    await waitFor(() => expect(trigger).toHaveTextContent('Paul Durand'))
  })
})

describe('Profils page (admin)', () => {
  const list = () => Response.json([claire, old])

  test('delete dialog states the number of forms and archive instead of delete', async () => {
    queryClient.setQueryData(meQueryKey, adminMe)
    const calls = stubApi({
      'GET /profiles?include_archived=true': list,
      'GET /profiles/p1/deletion-impact': () => Response.json({ forms_count: 3, will_archive: true }),
      'DELETE /profiles/p1': () => Response.json({ forms_count: 3, archived: true }),
    })
    renderWithQuery(<ProfilesPage />)
    expect(await screen.findByText('Archivé')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Supprimer Ancien' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer Claire Martin' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(await within(dialog).findByText(/possède 3 fiches/)).toBeInTheDocument()
    expect(dialog).toHaveTextContent('archivé')
    expect(dialog).toHaveTextContent('Claire Martin (profil supprimé)')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archiver le profil' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'DELETE /profiles/p1')).toBe(true))
    expect(calls.find((c) => c.key === 'DELETE /profiles/p1')!.csrf).toBe('csrf-admin')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Profil archivé (3 fiches conservées).'))
  })

  test('a profile without forms is deleted for good', async () => {
    queryClient.setQueryData(meQueryKey, adminMe)
    stubApi({
      'GET /profiles?include_archived=true': list,
      'GET /profiles/p1/deletion-impact': () => Response.json({ forms_count: 0, will_archive: false }),
    })
    renderWithQuery(<ProfilesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer Claire Martin' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(await within(dialog).findByText(/supprimé définitivement/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Supprimer définitivement' })).toBeInTheDocument()
  })

  const openCreateDialog = async (routes: Record<string, () => Response>) => {
    queryClient.setQueryData(meQueryKey, adminMe)
    const calls = stubApi(routes)
    renderWithQuery(<ProfilesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Nouveau profil' }))
    return { calls, dialog: await screen.findByRole('dialog') }
  }

  test('create form shows « Numéro », prefilled with the smallest number free among active profiles', async () => {
    // 2 belongs to an archived profile and 3 to paul: 2 is free again.
    const { dialog } = await openCreateDialog({ 'GET /profiles?include_archived=true': () => Response.json([claire, old, paul]) })
    expect(within(dialog).getByLabelText('Numéro')).toHaveValue('2')
    expect(within(dialog).getByLabelText('Numéro')).toHaveAttribute('inputmode', 'numeric')
  })

  test('create form validates, rejects non-digits in French, then shows the server 422 on the field', async () => {
    const { calls, dialog } = await openCreateDialog({
      'GET /profiles?include_archived=true': () => Response.json([]),
      'POST /profiles': () => Response.json({ detail: [{ loc: ['body', 'number'], msg: 'Le numéro doit être un nombre entier de 1 à 999.' }] }, { status: 422 }),
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Créer le profil' }))
    expect(await within(dialog).findByText('Le nom affiché est obligatoire.')).toBeInTheDocument()
    expect(calls.some((c) => c.key === 'POST /profiles')).toBe(false)
    fireEvent.change(within(dialog).getByLabelText('Nom affiché'), { target: { value: 'Léa Bernard' } })
    for (const bad of ['12a', '0', '1000', '', '-3']) {
      fireEvent.change(within(dialog).getByLabelText('Numéro'), { target: { value: bad } })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Créer le profil' }))
      expect(await within(dialog).findByText('Le numéro doit être un nombre entier de 1 à 999.')).toBeInTheDocument()
    }
    expect(calls.some((c) => c.key === 'POST /profiles')).toBe(false)
    fireEvent.change(within(dialog).getByLabelText('Numéro'), { target: { value: '42' } })
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Bleu' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Créer le profil' }))
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /profiles')).toBe(true))
    expect(calls.find((c) => c.key === 'POST /profiles')!.body).toEqual({ display_name: 'Léa Bernard', number: 42, color: '#2b6cb0' })
    expect(await within(dialog).findByText('Le numéro doit être un nombre entier de 1 à 999.')).toBeInTheDocument()
  })

  test('a server 409 (number already taken) lands on the Numéro field', async () => {
    const taken = 'Le numéro 1 est déjà attribué au profil Claire Martin.'
    const { dialog } = await openCreateDialog({
      'GET /profiles?include_archived=true': () => Response.json([claire]),
      'POST /profiles': () => Response.json({ detail: taken }, { status: 409 }),
    })
    fireEvent.change(within(dialog).getByLabelText('Nom affiché'), { target: { value: 'Léa Bernard' } })
    fireEvent.change(within(dialog).getByLabelText('Numéro'), { target: { value: '1' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Créer le profil' }))
    expect(await within(dialog).findByText(taken)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Numéro')).toHaveAttribute('aria-invalid', 'true')
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('the table and the badges show the profile number', async () => {
    queryClient.setQueryData(meQueryKey, adminMe)
    stubApi({ 'GET /profiles?include_archived=true': () => Response.json([claire, paul]) })
    renderWithQuery(<ProfilesPage />)
    const rows = await screen.findAllByRole('row')
    expect(within(rows[0]).getByText('Numéro')).toBeInTheDocument()
    expect(rows.slice(1).map((r) => [within(r).getAllByRole('cell')[0].textContent, within(r).getAllByRole('cell')[1].textContent])).toEqual([
      ['1Claire Martin', '1'],
      ['3Paul Durand', '3'],
    ])
  })
})
