import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import AnnexesPage from '@/annexes/AnnexesPage'
import type { Me } from '@/auth/session'
import { meQueryKey, queryClient } from '@/lib/api'

const annex = { id: 'a1', title: 'Protocole de dilution', filename: 'dilution.pdf', size: 2048, sha256: 'x', excerpt: 'Diluer à 10 %.', created_at: '2026-01-02T10:00:00Z' }
const me = (role: 'admin' | 'user'): Me => ({ role, active_profile: null, csrf_token: `csrf-${role}` })

const renderPage = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AnnexesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
})

describe('Annexes page', () => {
  test('the user account can search and open but sees no write control', async () => {
    queryClient.setQueryData(meQueryKey, me('user'))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([annex])))
    renderPage()
    const link = await screen.findByRole('link', { name: /Protocole de dilution/ })
    expect(link).toHaveAttribute('href', '/api/annexes/a1/file')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByLabelText('Rechercher une annexe')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Modifier|Supprimer|Choisir un fichier/ })).not.toBeInTheDocument()
  })

  test('admin: a non-PDF and an oversize file are refused in French before any upload', async () => {
    queryClient.setQueryData(meQueryKey, me('admin'))
    const fetchMock = vi.fn().mockResolvedValue(Response.json([]))
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    const input = await screen.findByLabelText('Fichier PDF')
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    expect(await screen.findByRole('alert')).toHaveTextContent("« notes.txt » n'est pas un PDF")
    const big = new File(['x'], 'gros.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 25 * 1024 * 1024 })
    fireEvent.change(input, { target: { files: [big] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('trop volumineux')
    expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true)
  })

  test('admin: deleting a referenced annex lists the templates from the 409', async () => {
    queryClient.setQueryData(meQueryKey, me('admin'))
    const fetchMock = vi.fn(async (_: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? Response.json({ detail: "Cette annexe est utilisée par des templates.", templates: ['Préparation magistrale', 'Stupéfiants'] }, { status: 409 })
        : Response.json([annex]),
    )
    vi.stubGlobal('fetch', fetchMock)
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer Protocole de dilution' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: "Supprimer l'annexe" }))
    expect(await within(dialog).findByText('Cette annexe est utilisée par des templates.')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Préparation magistrale', 'Stupéfiants'])
    const del = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE')!
    expect((del[1] as { headers: Record<string, string> }).headers['X-CSRF-Token']).toBe('csrf-admin')
  })
})
