import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { AnnexInfo } from '@/annexes/AnnexInfo'
import { AnnexPicker } from '@/templates/editor/AnnexPicker'
import { queryClient } from '@/lib/api'

const annex = { id: 'a1', title: 'Protocole de dilution', folder_id: null, body_html: '<p>Diluer</p>', excerpt: 'Diluer à 10 % dans du sérum physiologique.', created_at: '2026-01-02T10:00:00Z', updated_at: '2026-01-02T10:00:00Z' }

beforeAll(() => {
  // Radix popper needs ResizeObserver, absent from jsdom.
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => {
  queryClient.clear()
  vi.clearAllMocks()
})

const renderInfo = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <AnnexInfo annexId="a1" label="Protocole" />
    </QueryClientProvider>,
  )

describe('AnnexInfo', () => {
  test('keyboard focus on the icon shows the excerpt; the link opens the note in a new tab', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(annex))
    vi.stubGlobal('fetch', fetchMock)
    renderInfo()
    const icon = await screen.findByRole('link', { name: 'Annexe\u00a0: Protocole' })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())
    // the preview only exists once the annex is loaded; the trigger then switches to the hover card
    await vi.waitFor(() => expect(screen.getByRole('link', { name: 'Annexe\u00a0: Protocole' })).toHaveAttribute('aria-describedby'))
    expect(screen.queryByText(annex.excerpt)).not.toBeInTheDocument()
    await act(async () => icon.focus())
    expect(await screen.findByText(annex.excerpt)).toBeInTheDocument()
    expect(screen.getByText(annex.title)).toBeInTheDocument()
    expect(screen.getByText("Ouvrir l'annexe")).toBeInTheDocument()
    expect(icon).toHaveAttribute('href', '/annexes/notes/a1')
    expect(icon).toHaveAttribute('target', '_blank')
    expect(icon).toHaveAttribute('rel', 'noopener')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/annexes/a1')
    // the excerpt itself is clickable and goes to the same note
    expect(screen.getByText(annex.excerpt).closest('a')).toHaveAttribute('href', '/annexes/notes/a1')
    fireEvent.keyDown(icon, { key: 'Escape' })
  })

  test('hover shows the excerpt too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(annex)))
    renderInfo()
    const icon = await screen.findByRole('link', { name: 'Annexe\u00a0: Protocole' })
    await vi.waitFor(() => expect(screen.getByRole('link', { name: 'Annexe\u00a0: Protocole' })).toHaveAttribute('aria-describedby'))
    fireEvent.pointerEnter(icon)
    expect(await screen.findByText(annex.excerpt)).toBeInTheDocument()
  })

  test('a deleted annex (404) shows « Annexe supprimée » and no link', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: 'Annexe introuvable.' }, { status: 404 })))
    renderInfo()
    expect(await screen.findByText('Annexe supprimée')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

describe('AnnexPicker', () => {
  test('each result shows its folder path under the title', async () => {
    const note = { ...annex, folder_id: 'f2' }
    const tree = { folders: [{ id: 'f1', name: 'Protocoles', parent_id: null }, { id: 'f2', name: 'Stupéfiants', parent_id: 'f1' }], notes: [note] }
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url === '/api/annexes/tree' ? tree : [note])))
    render(
      <QueryClientProvider client={queryClient}>
        <AnnexPicker id="picker" value={null} onChange={() => {}} />
      </QueryClientProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Lier une annexe' }))
    expect(await screen.findByText('Protocole de dilution')).toBeInTheDocument()
    expect(await screen.findByText('Annexes / Protocoles / Stupéfiants')).toBeInTheDocument()
  })
})
