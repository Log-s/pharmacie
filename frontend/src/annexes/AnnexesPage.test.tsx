import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import AnnexesPage from '@/annexes/AnnexesPage'
import type { Me } from '@/auth/session'
import { meQueryKey, queryClient } from '@/lib/api'

// Flat payload, deliberately unsorted: the page builds and sorts the tree.
const note = (id: string, title: string, folder_id: string | null) => ({ id, title, folder_id, excerpt: `Extrait de ${title}`, updated_at: '2026-01-02T10:00:00Z' })
const tree = {
  folders: [
    { id: 'f2', name: 'Stupéfiants', parent_id: 'f1' },
    { id: 'f1', name: 'Protocoles', parent_id: null },
    { id: 'f3', name: 'Archives', parent_id: null },
    { id: 'f4', name: 'Anciens', parent_id: 'f3' },
  ],
  notes: [note('n1', 'Protocole de dilution', 'f1'), note('n2', 'Accueil', null), note('n3', 'Registre des stupéfiants', 'f2'), note('n4', 'Ampoules', 'f1')],
}
const me = (role: 'admin' | 'user'): Me => ({ role, active_profile: null, csrf_token: `csrf-${role}` })

const renderPage = (path = '/annexes') =>
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AnnexesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

const stubFetch = (extra?: (url: string, init?: RequestInit) => Response | undefined) => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => extra?.(url, init) ?? Response.json(tree))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const names = (items: HTMLElement[]) => items.map((item) => item.textContent)
const treeNav = () => screen.findByRole('navigation', { name: 'Arborescence des annexes' })

beforeAll(() => {
  // Radix Select needs these, absent from jsdom.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.scrollIntoView = () => {}
})
afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
})

describe('Annexes page', () => {
  test('builds the tree from the flat payload: sub-folders before notes, alphabetical', async () => {
    queryClient.setQueryData(meQueryKey, me('user'))
    stubFetch()
    renderPage('/annexes?dossier=f2')
    const nav = await treeNav()
    // the path to the current folder is unfolded; Archives stays folded
    expect(names(within(nav).getAllByRole('link'))).toEqual(['Annexes', 'Archives', 'Protocoles', 'Stupéfiants', 'Registre des stupéfiants', 'Ampoules', 'Protocole de dilution', 'Accueil'])
    expect(within(nav).getByRole('link', { name: 'Stupéfiants' })).toHaveAttribute('aria-current', 'page')
    const toggle = within(nav).getByRole('button', { name: 'Déplier Archives' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(within(nav).getByRole('button', { name: 'Replier Archives' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(nav).getByRole('link', { name: 'Anciens' })).toBeInTheDocument()
  })

  test('root content lists folders then notes; notes link to /annexes/notes/<id>', async () => {
    queryClient.setQueryData(meQueryKey, me('user'))
    stubFetch()
    renderPage()
    const content = await screen.findByRole('region', { name: 'Contenu du dossier' })
    expect(names(within(content).getAllByRole('link')).slice(1)).toEqual(['Archives', 'Protocoles', 'Accueil']) // after « Exporter en PDF »
    expect(within(content).getByRole('link', { name: 'Accueil' })).toHaveAttribute('href', '/annexes/notes/n2')
  })

  test('?dossier= shows the breadcrumb and that folder\'s content', async () => {
    queryClient.setQueryData(meQueryKey, me('user'))
    stubFetch()
    renderPage('/annexes?dossier=f2')
    const crumb = await screen.findByRole('navigation', { name: "Fil d'Ariane" })
    expect(names(within(crumb).getAllByRole('link'))).toEqual(['Annexes', 'Protocoles'])
    expect(within(crumb).getByRole('heading', { name: 'Stupéfiants' })).toHaveAttribute('aria-current', 'page')
    const content = screen.getByRole('region', { name: 'Contenu du dossier' })
    expect(within(content).getByRole('link', { name: 'Registre des stupéfiants' })).toHaveAttribute('href', '/annexes/notes/n3')
  })

  test('the user sees « Exporter en PDF » and no admin action', async () => {
    queryClient.setQueryData(meQueryKey, me('user'))
    stubFetch()
    renderPage('/annexes?dossier=f1')
    const link = await screen.findByRole('link', { name: /Exporter en PDF/ })
    expect(link).toHaveAttribute('href', '/api/annexes/export.pdf?folder_id=f1')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener')
    expect(screen.queryByRole('button', { name: /Nouveau dossier|Renommer|Déplacer|Supprimer/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Nouvelle note' })).not.toBeInTheDocument()
  })

  test('the export covers the whole tree at the root (no folder_id)', async () => {
    queryClient.setQueryData(meQueryKey, me('user'))
    stubFetch()
    renderPage()
    expect(await screen.findByRole('link', { name: /Exporter en PDF/ })).toHaveAttribute('href', '/api/annexes/export.pdf')
  })

  test('the admin sees the five actions; « Nouvelle note » targets the current folder', async () => {
    queryClient.setQueryData(meQueryKey, me('admin'))
    stubFetch()
    renderPage('/annexes?dossier=f1')
    expect(await screen.findByRole('link', { name: /Exporter en PDF/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nouvelle note' })).toHaveAttribute('href', '/annexes/notes/nouvelle?dossier=f1')
    for (const name of ['Nouveau dossier', 'Renommer', 'Déplacer', 'Supprimer']) expect(screen.getByRole('button', { name })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Supprimer Ampoules' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Déplacer Ampoules' })).toBeInTheDocument()
  })

  test('at the root « Nouvelle note » has no folder and the folder actions are absent', async () => {
    queryClient.setQueryData(meQueryKey, me('admin'))
    stubFetch()
    renderPage()
    expect(await screen.findByRole('link', { name: 'Nouvelle note' })).toHaveAttribute('href', '/annexes/notes/nouvelle')
    expect(screen.getByRole('button', { name: 'Nouveau dossier' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Renommer' })).not.toBeInTheDocument()
  })

  test('search shows a flat list with the folder path under each title', async () => {
    queryClient.setQueryData(meQueryKey, me('user'))
    const fetchMock = stubFetch((url) => (url.startsWith('/api/annexes?q=') ? Response.json([tree.notes[2], tree.notes[1]]) : undefined))
    renderPage()
    fireEvent.change(await screen.findByLabelText('Rechercher une annexe'), { target: { value: 'regis' } })
    const content = screen.getByRole('region', { name: 'Contenu du dossier' })
    expect(await within(content).findByText('Annexes / Protocoles / Stupéfiants')).toBeInTheDocument()
    expect(within(content).getByText('Annexes')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/annexes?q=regis', expect.anything())
  })

  test('deleting a folder states the affected counts, then lists the templates from a 409', async () => {
    queryClient.setQueryData(meQueryKey, me('admin'))
    const fetchMock = stubFetch((_, init) =>
      init?.method === 'DELETE'
        ? Response.json({ detail: 'Une note de ce dossier est utilisée par des templates.', templates: ['Préparation magistrale', 'Stupéfiants'] }, { status: 409 })
        : undefined,
    )
    renderPage('/annexes?dossier=f1')
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }))
    const dialog = await screen.findByRole('alertdialog')
    // Protocoles holds 2 notes + 1 sub-folder (Stupéfiants) holding 1 more note
    expect(within(dialog).getByText(/3 notes et 1 sous-dossier/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Supprimer' }))
    expect(await within(dialog).findByText('Une note de ce dossier est utilisée par des templates.')).toBeInTheDocument()
    expect(names(within(dialog).getAllByRole('listitem'))).toEqual(['Préparation magistrale', 'Stupéfiants'])
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')!
    expect(del[0]).toBe('/api/annex-folders/f1')
    expect((del[1] as { headers: Record<string, string> }).headers['X-CSRF-Token']).toBe('csrf-admin')
  })

  test('the move dialog offers the root and every folder except the moved one and its descendants', async () => {
    queryClient.setQueryData(meQueryKey, me('admin'))
    stubFetch()
    renderPage('/annexes?dossier=f1')
    fireEvent.click(await screen.findByRole('button', { name: 'Déplacer' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(within(dialog).getByRole('combobox', { name: 'Destination' }), { key: 'ArrowDown' })
    const options = await screen.findAllByRole('option')
    expect(names(options)).toEqual(['Racine (Annexes)', 'Annexes / Archives', 'Annexes / Archives / Anciens'])
  })

  test('moving a note offers every folder', async () => {
    queryClient.setQueryData(meQueryKey, me('admin'))
    stubFetch()
    renderPage('/annexes?dossier=f1')
    fireEvent.click(await screen.findByRole('button', { name: 'Déplacer Ampoules' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.keyDown(within(dialog).getByRole('combobox', { name: 'Destination' }), { key: 'ArrowDown' })
    expect(names(await screen.findAllByRole('option'))).toHaveLength(5)
  })
})
