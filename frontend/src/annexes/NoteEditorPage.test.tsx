import { QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Me } from '@/auth/session'
import NoteEditorPage from '@/annexes/NoteEditorPage'
import { meQueryKey, queryClient } from '@/lib/api'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const note = { id: 'n1', title: 'Protocole', folder_id: 'f1', body_html: '<p>Diluer</p>', excerpt: 'Diluer', created_at: '2026-01-02T10:00:00Z', updated_at: '2026-01-02T10:00:00Z' }
const tree = { folders: [{ id: 'f1', name: 'Protocoles', parent_id: null }], notes: [] }

afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
})

function setup(path: string) {
  queryClient.setQueryData<Me>(meQueryKey, { role: 'admin', active_profile: null, csrf_token: 'csrf' })
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/annexes/tree') return Response.json(tree)
    if (init?.method === 'POST') return Response.json({ ...note, id: 'n2' }, { status: 201 })
    if (init?.method === 'PATCH') return Response.json(note)
    return Response.json(note)
  })
  vi.stubGlobal('fetch', fetchMock)
  const router = createMemoryRouter(
    [
      { path: '/annexes/notes/nouvelle', element: <NoteEditorPage /> },
      { path: '/annexes/notes/:id/modifier', element: <NoteEditorPage /> },
      { path: '/annexes/notes/:id', element: <p>Page de la note</p> },
    ],
    { initialEntries: [path] },
  )
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  const writes = () => fetchMock.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET')
  return { writes, router }
}

// jsdom cannot type into contenteditable; Tiptap exposes the instance on the editable element.
const tiptap = () => (document.querySelector('.ProseMirror') as HTMLElement & { editor: Editor }).editor

describe('Note editor', () => {
  test('toolbar applies bold and underline; a new note is POSTed with the HTML and the folder from ?dossier=', async () => {
    const { writes, router } = setup('/annexes/notes/nouvelle?dossier=f1')
    expect(await screen.findByText('Dossier : Annexes / Protocoles')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Titre'), { target: { value: 'Dilution' } })
    await act(async () => void tiptap().chain().focus().insertContent('Bonjour').selectAll().run())

    const bold = screen.getByRole('button', { name: 'Gras' })
    const underline = screen.getByRole('button', { name: 'Souligné' })
    expect(bold).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(bold)
    fireEvent.click(underline)
    await waitFor(() => expect(bold).toHaveAttribute('aria-pressed', 'true'))
    expect(underline).toHaveAttribute('aria-pressed', 'true')
    expect(tiptap().getHTML()).toMatch(/<strong>.*<\/strong>/)
    expect(tiptap().getHTML()).toMatch(/<u>.*<\/u>/)

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/annexes/notes/n2'))
    const [[url, init]] = writes()
    expect([url, init?.method]).toEqual(['/api/annexes', 'POST'])
    const body = JSON.parse(init?.body as string)
    expect(body).toMatchObject({ title: 'Dilution', folder_id: 'f1' })
    expect(body.body_html).toMatch(/<strong>.*<\/strong>/)
    expect(body.body_html).toMatch(/<u>.*<\/u>/)
    expect(body.body_html).toContain('Bonjour')
  })

  test('editing a note PATCHes the new HTML without moving it', async () => {
    const { writes, router } = setup('/annexes/notes/n1/modifier')
    expect(await screen.findByDisplayValue('Protocole')).toBeInTheDocument()
    await waitFor(() => expect(tiptap().getHTML()).toBe('<p>Diluer</p>'))
    await act(async () => void tiptap().chain().focus().insertContentAt(tiptap().state.doc.content.size - 1, ' à 10 %').run())
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/annexes/notes/n1'))
    const [[url, init]] = writes()
    expect([url, init?.method]).toEqual(['/api/annexes/n1', 'PATCH'])
    expect(JSON.parse(init?.body as string)).toEqual({ title: 'Protocole', body_html: '<p>Diluer à 10 %</p>' })
  })

  test('an empty title is refused before any request', async () => {
    const { writes } = setup('/annexes/notes/nouvelle')
    fireEvent.click(await screen.findByRole('button', { name: 'Enregistrer' }))
    expect(await screen.findByText('Saisissez un titre.')).toBeInTheDocument()
    expect(writes()).toHaveLength(0)
  })

  test('a link outside http, https and mailto is refused', async () => {
    setup('/annexes/notes/nouvelle')
    await screen.findByRole('toolbar', { name: 'Mise en forme' })
    await act(async () => {
      tiptap().chain().focus().insertContent('lien').selectAll().run()
      await new Promise(requestAnimationFrame) // Tiptap's focus() lands on the next frame and would dismiss the popover
    })
    fireEvent.click(screen.getByRole('button', { name: 'Lien' }))
    fireEvent.change(await screen.findByLabelText('Adresse du lien'), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByText('Appliquer')) // Radix keeps the positioned popover out of the a11y tree in jsdom
    expect(await screen.findByText(/Seules les adresses/)).toBeInTheDocument()
    expect(tiptap().getHTML()).not.toContain('href')
  })
})
