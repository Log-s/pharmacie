import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import App from '@/App'

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  )
}

afterEach(() => vi.unstubAllGlobals())

test('shows the API as available when /api/health answers', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'ok' }))
  vi.stubGlobal('fetch', fetchMock)
  renderApp()
  expect(await screen.findByText('disponible')).toBeInTheDocument()
  expect(fetchMock).toHaveBeenCalledWith('/api/health')
})

test('shows the API as unreachable on error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 502 })))
  renderApp()
  expect(await screen.findByText('injoignable')).toBeInTheDocument()
})
