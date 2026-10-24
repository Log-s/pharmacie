import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import JournalPage from '@/admin/JournalPage'
import { queryClient } from '@/lib/api'

const entry = (id: number) => ({ id, at: '2026-03-04T09:30:00Z', account_role: 'user', profile_id: 'p1', profile_name: 'Claire Martin', action: 'profile_switch', target_type: 'profile', target_id: 'p1', details: { from: null, to: 'p1' } })

afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
})

describe('Journal page', () => {
  test('lists entries, paginates server-side and shows the empty state', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        if (url === '/api/journal/actions') return Response.json(['profile_switch'])
        if (url === '/api/profiles?include_archived=true') return Response.json([])
        const page = Number(new URL(url, 'http://x').searchParams.get('page'))
        return Response.json({ items: [entry(page)], total: 120, page, page_size: 50 })
      }),
    )
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <JournalPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByRole('cell', { name: 'Changement de profil' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Claire Martin' })).toBeInTheDocument()
    expect(screen.getByText('120 entrées · page 1 sur 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Précédente' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Suivante' }))
    await waitFor(() => expect(screen.getByText('120 entrées · page 2 sur 3')).toBeInTheDocument())
    expect(urls.some((u) => u === '/api/journal?page=2&page_size=50')).toBe(true)
  })
})
