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

const admin: Me = { role: 'admin', active_profile: null, csrf_token: 'csrf-admin' }
const TID = '11111111-1111-4111-8111-111111111111'
const tree = {
  nodes: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      type: 'checkbox_group',
      label: 'Contrôles',
      required: false,
      help: null,
      annex_ref: null,
      options: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          label: 'Écart',
          children: [
            { id: '00000000-0000-4000-8000-000000000003', type: 'text', label: 'Détail', required: false, help: null, annex_ref: null, multiline: false, max_length: null },
          ],
        },
      ],
    },
  ],
}
const detail = {
  id: TID,
  name: 'Contrôle des préparations',
  archived_at: null,
  latest_version: 1,
  versions: [{ id: 'v1', template_id: TID, version: 1, published_at: '2026-10-24T10:00:00Z', schema_json: tree }],
}

function renderAt(path: string, handler: (url: string, init?: RequestInit) => Response) {
  queryClient.setQueryData(meQueryKey, admin)
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init))
  vi.stubGlobal('fetch', fetchMock)
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
    </QueryClientProvider>,
  )
  return fetchMock
}

afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
})

describe('Templates page', () => {
  test('lists templates with their published version and state', async () => {
    renderAt('/templates', () =>
      Response.json([
        { id: 'a', name: 'Ancien', archived_at: '2026-01-01T00:00:00Z', latest_version: 2 },
        { id: 'b', name: 'Brouillon', archived_at: null, latest_version: null },
      ]),
    )
    const rows = await screen.findAllByRole('row')
    expect(rows.map((r) => r.textContent)).toEqual(['NomVersion publiéeÉtatActions', 'BrouillonJamais publiéActif', 'AncienVersion 2Archivé'])
    expect(screen.getByRole('link', { name: 'Brouillon' })).toHaveAttribute('href', '/templates/b')
    expect(screen.getByRole('link', { name: 'Nouveau template' })).toHaveAttribute('href', '/templates/nouveau')
  })
})

describe('Template editor', () => {
  test('edits a node, the live preview follows, publish sends the tree', async () => {
    const fetchMock = renderAt(`/templates/${TID}`, (url, init) => {
      if (url === `/api/templates/${TID}/versions` && init?.method === 'POST')
        return Response.json({ ...detail.versions[0], id: 'v2', version: 2, schema_json: JSON.parse(String(init.body)) }, { status: 201 })
      return Response.json(detail)
    })
    const preview = await screen.findByRole('region', { name: 'Aperçu de la fiche' })
    expect(within(preview).getByRole('checkbox', { name: 'Écart' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Publier la version 2' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: /^Contrôles/ }))
    fireEvent.change(screen.getByLabelText("Libellé de l'option 1"), { target: { value: 'Non conforme' } })
    expect(within(preview).getByRole('checkbox', { name: 'Non conforme' })).toBeInTheDocument()
    fireEvent.click(within(preview).getByRole('checkbox', { name: 'Non conforme' }))
    expect(within(preview).getByLabelText('Détail')).toBeInTheDocument() // conditional child shown in the preview

    fireEvent.click(screen.getByRole('button', { name: 'Publier la version 2' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!
    expect(JSON.parse(String(init!.body)).nodes[0].options[0].label).toBe('Non conforme')
  })

  test('client validation blocks the publish and points at the node', async () => {
    const fetchMock = renderAt(`/templates/${TID}`, () => Response.json(detail))
    fireEvent.click(await screen.findByRole('button', { name: /^Détail/ }))
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publier la version 2' }))
    expect(await screen.findByText('Publication impossible : 1 erreur à corriger')).toBeInTheDocument()
    expect(screen.getByLabelText('Libellé')).toHaveAttribute('aria-invalid', 'true')
    expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
  })

  test('a server 422 is shown and attached to the node', async () => {
    renderAt(`/templates/${TID}`, (_url, init) =>
      init?.method === 'POST'
        ? Response.json({ detail: [{ type: 'value_error', loc: ['body', 'nodes', 0, 'checkbox_group', 'label'], msg: 'Value error, Libellé refusé.' }] }, { status: 422 })
        : Response.json(detail),
    )
    fireEvent.click(await screen.findByRole('button', { name: /^Contrôles/ }))
    fireEvent.change(screen.getByLabelText('Libellé'), { target: { value: 'Contrôles du jour' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publier la version 2' }))
    expect(await screen.findByText('Le serveur a refusé la publication')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^« Contrôles du jour »\s: Libellé refusé\.$/ })).toBeInTheDocument()
  })
})
