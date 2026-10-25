import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Me } from '@/auth/session'
import { meQueryKey, queryClient } from '@/lib/api'
import { routes } from '@/router'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const user = (id: string): Me => ({ role: 'user', active_profile: { id, display_name: id === 'A' ? 'Alice Martin' : 'Bruno Petit', number: id === 'A' ? 1 : 2, color: '#3a7' }, csrf_token: 'csrf-user' })
const admin: Me = { role: 'admin', active_profile: null, csrf_token: 'csrf-admin' }

const REF_NODE = '00000000-0000-4000-8000-0000000000a1'
const TEXT_NODE = '00000000-0000-4000-8000-0000000000a2'
const tree = {
  nodes: [
    { id: REF_NODE, type: 'reference', label: 'Référence', required: true, help: null, annex_ref: null },
    { id: TEXT_NODE, type: 'text', label: 'Observation', required: false, help: null, annex_ref: null, multiline: false, max_length: null },
  ],
}
const owner = { id: 'A', display_name: 'Alice Martin', number: 1, color: '#3a7', archived: false }
const summary = (over: object = {}) => ({
  id: 'f1', reference: '10-2026-001', template_id: 't1', template_name: 'Contrôle', template_version_id: 'v1', version: 1,
  owner, created_at: '2026-10-20T10:00:00Z', updated_at: '2026-10-21T10:00:00Z', can_edit: true, ...over,
})
const detail = (over: object = {}) => ({ ...summary(over), data: { [TEXT_NODE]: 'RAS' }, schema_json: tree })

type Handler = (url: string, init?: RequestInit) => Response | undefined
function renderAt(path: string, me: Me, handler: Handler) {
  queryClient.setQueryData(meQueryKey, me)
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init) ?? Response.json([]))
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  )
  return fetchMock
}
const urls = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls.map(([url]) => String(url))

afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Fiche view: ownership-aware actions', () => {
  const view = (me: Me, over: object = {}) => renderAt('/fiches/f1', me, (url) => (url === '/api/forms/f1' ? Response.json(detail(over)) : undefined))

  test('the owner (active profile) sees Modifier and Supprimer, and no « Fiche de »', async () => {
    view(user('A'))
    expect(await screen.findByRole('link', { name: 'Modifier' })).toHaveAttribute('href', '/fiches/f1/modifier')
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exporter en PDF' })).toBeInTheDocument()
    expect(screen.queryByTestId('fiche-de')).toBeNull()
  })

  test('another profile gets a read-only view with « Fiche de Nom » and no write button', async () => {
    view(user('B'), { can_edit: false })
    const note = await screen.findByTestId('fiche-de')
    expect(note).toHaveTextContent(/^Fiche de/)
    expect(within(note).getByText('Alice Martin')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Modifier' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Supprimer' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Exporter en PDF' })).toBeInTheDocument()
  })

  test('an archived owner shows « Nom (profil supprimé) »', async () => {
    view(user('B'), { can_edit: false, owner: { ...owner, archived: true } })
    expect(await screen.findByTestId('fiche-de')).toHaveTextContent('Alice Martin (profil supprimé)')
  })

  test('the admin sees Modifier and Supprimer on any fiche', async () => {
    view(admin)
    expect(await screen.findByRole('link', { name: 'Modifier' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Supprimer' })).toBeInTheDocument()
    expect(screen.getByTestId('fiche-de')).toHaveTextContent('Alice Martin')
  })

  test('Supprimer asks for confirmation before calling DELETE', async () => {
    const fetchMock = renderAt('/fiches/f1', user('A'), (url, init) => {
      if (url === '/api/forms/f1' && init?.method === 'DELETE') return new Response(null, { status: 204 })
      if (url === '/api/forms/f1') return Response.json(detail())
      if (url.startsWith('/api/forms?')) return Response.json({ items: [], total: 0, page: 1, page_size: 25 })
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/Supprimer la fiche 10-2026-001/)).toBeInTheDocument()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer définitivement' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url === '/api/forms/f1' && init?.method === 'DELETE')).toBe(true))
    expect(await screen.findByRole('heading', { name: 'Fiches' })).toBeInTheDocument()
  })

  test('Exporter en PDF calls /api/forms/{id}/pdf and saves <reference>.pdf', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:pdf')
    URL.revokeObjectURL = vi.fn()
    const saved: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download)
    })
    const fetchMock = renderAt('/fiches/f1', user('B'), (url) => {
      if (url === '/api/forms/f1/pdf') return new Response(new Blob(['%PDF-1.7']), { headers: { 'Content-Type': 'application/pdf' } })
      if (url === '/api/forms/f1') return Response.json(detail({ can_edit: false }))
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Exporter en PDF' }))
    await waitFor(() => expect(saved).toEqual(['10-2026-001.pdf']))
    expect(urls(fetchMock)).toContain('/api/forms/f1/pdf')
  })
})

describe('Fiches list', () => {
  const list = (path: string, me: Me = user('A')) =>
    renderAt(path, me, (url) => {
      if (url.startsWith('/api/forms?')) return Response.json({ items: [summary()], total: 1, page: 1, page_size: 25 })
    })
  const formsCalls = (fetchMock: ReturnType<typeof vi.fn>) => urls(fetchMock).filter((u) => u.startsWith('/api/forms?')).map((u) => new URLSearchParams(u.split('?')[1]))

  test('lists fiches with the owner badge; the user has « Nouvelle fiche », the admin does not', async () => {
    list('/fiches')
    expect(await screen.findByRole('link', { name: '10-2026-001' })).toHaveAttribute('href', '/fiches/f1')
    expect(within(screen.getByRole('table')).getByText('Alice Martin')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nouvelle fiche' })).toHaveAttribute('href', '/fiches/nouvelle')
  })

  test('the admin cannot create', async () => {
    list('/fiches', admin)
    await screen.findByRole('link', { name: '10-2026-001' })
    expect(screen.queryByRole('link', { name: 'Nouvelle fiche' })).toBeNull()
  })

  test('search is debounced and sent to the server as q; reference too', async () => {
    const fetchMock = list('/fiches')
    await screen.findByRole('link', { name: '10-2026-001' })
    fireEvent.change(screen.getByLabelText('Rechercher'), { target: { value: 'amox' } })
    fireEvent.change(screen.getByLabelText('Rechercher'), { target: { value: 'amoxi' } })
    expect(formsCalls(fetchMock).some((p) => p.has('q'))).toBe(false) // nothing before the pause
    await waitFor(() => expect(formsCalls(fetchMock).some((p) => p.get('q') === 'amoxi')).toBe(true))
    expect(formsCalls(fetchMock).some((p) => p.get('q') === 'amox')).toBe(false) // one call for the last text
    fireEvent.change(screen.getByLabelText('Référence'), { target: { value: '10-2026-0' } })
    await waitFor(() => expect(formsCalls(fetchMock).some((p) => p.get('reference') === '10-2026-0' && p.get('q') === 'amoxi')).toBe(true))
  })

  test('filters in the URL (dates, author, owner, template) become query params', async () => {
    const fetchMock = list('/fiches?date_from=2026-10-01&date_to=2026-10-31&author_id=A&owner_profile_id=B&template_id=t1&page=2')
    await screen.findByRole('link', { name: '10-2026-001' })
    const params = formsCalls(fetchMock).at(-1)!
    expect(Object.fromEntries(params)).toEqual({
      page: '2', page_size: '25', date_from: '2026-10-01', date_to: '2026-10-31', author_id: 'A', owner_profile_id: 'B', template_id: 't1',
    })
    expect(screen.getByRole('button', { name: 'Réinitialiser' })).toBeInTheDocument()
  })

  test('text the server would refuse (NUL) is flagged and never sent', async () => {
    const fetchMock = list('/fiches')
    await screen.findByRole('link', { name: '10-2026-001' })
    fireEvent.change(screen.getByLabelText('Rechercher'), { target: { value: 'a\u0000b' } })
    expect(await screen.findByText(/caractère nul ou invalide/)).toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 400))
    expect(formsCalls(fetchMock).every((p) => !p.get('q')?.includes('\u0000'))).toBe(true)
  })

  test('an empty result explains how to widen the search', async () => {
    renderAt('/fiches?q=zzz', user('A'), (url) => (url.startsWith('/api/forms?') ? Response.json({ items: [], total: 0, page: 1, page_size: 25 }) : undefined))
    expect(await screen.findByText('Aucune fiche trouvée')).toBeInTheDocument()
  })
})

describe('Fiche editor', () => {
  const edit = (put?: Handler) =>
    renderAt('/fiches/f1/modifier', user('A'), (url, init) => {
      if (url === '/api/forms/f1' && init?.method === 'PUT') return put?.(url, init)
      if (url === '/api/forms/f1') return Response.json(detail())
    })

  test('the owner edits; PUT sends the reference and the data', async () => {
    const fetchMock = edit(() => Response.json(detail()))
    const field = await screen.findByLabelText('Observation')
    expect(field).toHaveValue('RAS')
    fireEvent.change(field, { target: { value: 'Conforme' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT')!
    expect(JSON.parse(String(init!.body))).toEqual({ reference: '10-2026-001', data: { [TEXT_NODE]: 'Conforme' } })
    expect((init!.headers as Record<string, string>)['X-CSRF-Token']).toBe('csrf-user')
  })

  test('a non-owner who opens the edit URL lands on the read-only view', async () => {
    renderAt('/fiches/f1/modifier', user('B'), (url) => (url === '/api/forms/f1' ? Response.json(detail({ can_edit: false })) : undefined))
    expect(await screen.findByTestId('fiche-de')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull()
  })

  test('unsaved changes: leaving asks for confirmation (router blocker) and the tab close is warned (beforeunload)', async () => {
    edit()
    const field = await screen.findByLabelText('Observation')
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false) // nothing changed yet

    fireEvent.change(field, { target: { value: 'Modifié' } })
    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument()
    const dirty = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(dirty)
    expect(dirty.defaultPrevented).toBe(true)

    fireEvent.click(screen.getByRole('link', { name: 'Annexes' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Quitter sans enregistrer ?')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rester sur la fiche' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(screen.getByLabelText('Observation')).toHaveValue('Modifié')
  })

  test('putting the value back removes the warning', async () => {
    edit()
    const field = await screen.findByLabelText('Observation')
    fireEvent.change(field, { target: { value: 'Modifié' } })
    await screen.findByText('Modifications non enregistrées')
    fireEvent.change(field, { target: { value: 'RAS' } })
    await waitFor(() => expect(screen.queryByText('Modifications non enregistrées')).toBeNull())
  })

  test('a 409 on the reference is shown on the reference field', async () => {
    edit(() => Response.json({ detail: 'Cette référence est déjà utilisée par une autre fiche.' }, { status: 409 }))
    fireEvent.change(await screen.findByLabelText(/^Référence/), { target: { value: '10-2026-002' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    const message = await screen.findByText('Cette référence est déjà utilisée par une autre fiche.')
    expect(screen.getByLabelText(/^Référence/)).toHaveAttribute('aria-invalid', 'true')
    expect(message).toBeInTheDocument()
  })

  test('a 422 on a data field is shown on that field', async () => {
    edit(() => Response.json({ detail: [{ type: 'value_error', loc: ['body', 'data', TEXT_NODE], msg: '« Observation » : 10 caractères au plus.' }] }, { status: 422 }))
    fireEvent.change(await screen.findByLabelText('Observation'), { target: { value: 'trop long' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('10 caractères au plus.')).toBeInTheDocument()
    expect(screen.getByLabelText('Observation')).toHaveAttribute('aria-invalid', 'true')
  })

  test('an error that maps to no field is shown above the form', async () => {
    edit(() => Response.json({ detail: 'Fiche introuvable.' }, { status: 404 }))
    fireEvent.change(await screen.findByLabelText('Observation'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText("La fiche n'a pas été enregistrée")).toBeInTheDocument()
    expect(screen.getByText('Fiche introuvable.')).toBeInTheDocument()
  })
})

describe('New fiche', () => {
  const available = [{ id: 't1', name: 'Contrôle', version: { id: 'v1', template_id: 't1', version: 3, published_at: '2026-10-01T00:00:00Z', schema_json: tree } }]
  const create = (path = '/fiches/nouvelle') =>
    renderAt(path, user('A'), (url, init) => {
      if (url === '/api/templates/available') return Response.json(available)
      if (url === '/api/forms/next-reference') return Response.json({ reference: '10-2026-007' })
      if (url === '/api/forms' && init?.method === 'POST') return Response.json(detail({ id: 'f9', reference: '10-2026-007' }), { status: 201 })
      if (url === '/api/forms/f9') return Response.json(detail({ id: 'f9', reference: '10-2026-007' }))
    })

  test('picks a template, prefills the reference and creates the fiche with the version id', async () => {
    const fetchMock = create()
    fireEvent.click(await screen.findByRole('link', { name: /Contrôle/ }))
    const reference = await screen.findByLabelText(/^Référence/)
    await waitFor(() => expect(reference).toHaveValue('10-2026-007'))
    fireEvent.change(screen.getByLabelText('Observation'), { target: { value: 'Premier contrôle' } })
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    // The untouched proposal goes back as null: the server numbers it.
    expect(JSON.parse(String(init!.body))).toEqual({ template_version_id: 'v1', reference: null, data: { [TEXT_NODE]: 'Premier contrôle' } })
    expect(await screen.findByRole('heading', { name: '10-2026-007' })).toBeInTheDocument()
  })

  test('a fresh form is not dirty, typing makes it dirty', async () => {
    create('/fiches/nouvelle?template=t1')
    const field = await screen.findByLabelText('Observation')
    await waitFor(() => expect(screen.getByLabelText(/^Référence/)).toHaveValue('10-2026-007'))
    expect(screen.queryByText('Modifications non enregistrées')).toBeNull()
    fireEvent.change(field, { target: { value: 'x' } })
    expect(await screen.findByText('Modifications non enregistrées')).toBeInTheDocument()
  })

  test('without a published template, the page says so', async () => {
    renderAt('/fiches/nouvelle', user('A'), (url) => (url === '/api/templates/available' ? Response.json([]) : undefined))
    expect(await screen.findByText('Aucun template disponible')).toBeInTheDocument()
  })

  test('the admin cannot reach the creation page', async () => {
    renderAt('/fiches/nouvelle', admin, () => undefined)
    expect(await screen.findByText(/Accès refusé/i)).toBeInTheDocument()
  })
})
