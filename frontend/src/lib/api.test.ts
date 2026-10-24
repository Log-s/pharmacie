import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toast } from 'sonner'
import { api, ApiError, meQueryKey, queryClient } from '@/lib/api'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const me = { role: 'admin', active_profile: null, csrf_token: 'csrf-123' }
const fetchMock = vi.fn()

beforeEach(() => {
  queryClient.setQueryData(meQueryKey, me)
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const headersOf = (call = 0) => fetchMock.mock.calls[call][1].headers as Record<string, string>

describe('api client', () => {
  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('sends X-CSRF-Token on %s', async (method) => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(api('/things', { method, json: { a: 1 } })).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/things')
    expect(init.credentials).toBe('same-origin')
    expect(init.body).toBe('{"a":1}')
    expect(headersOf()['X-CSRF-Token']).toBe('csrf-123')
    expect(headersOf()['Content-Type']).toBe('application/json')
  })

  test('sends no CSRF header on GET and returns the JSON body', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }))
    await expect(api('/things')).resolves.toEqual({ ok: true })
    expect(headersOf()['X-CSRF-Token']).toBeUndefined()
  })

  test('401 clears the cached session so the guards redirect to the login page', async () => {
    fetchMock.mockResolvedValue(Response.json({ detail: 'Session absente ou expirée : reconnectez-vous.' }, { status: 401 }))
    const error = await api('/forms').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 401, message: 'Session absente ou expirée : reconnectez-vous.' })
    expect(queryClient.getQueryData(meQueryKey)).toBeNull()
  })

  test('401 on login (wrong password) keeps the session cache untouched', async () => {
    fetchMock.mockResolvedValue(Response.json({ detail: 'Mot de passe incorrect.' }, { status: 401 }))
    await expect(api('/auth/login', { method: 'POST', json: {} })).rejects.toMatchObject({ status: 401 })
    expect(queryClient.getQueryData(meQueryKey)).toEqual(me)
  })

  test('403 shows the server message in a toast and rejects', async () => {
    fetchMock.mockResolvedValue(Response.json({ detail: "Action réservée à l'administrateur." }, { status: 403 }))
    await expect(api('/admin/x', { method: 'POST' })).rejects.toMatchObject({ status: 403 })
    expect(toast.error).toHaveBeenCalledWith("Action réservée à l'administrateur.")
  })

  test('error shape: 422 validation list, non-JSON 500, network failure', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ detail: [{ type: 'missing', loc: ['body', 'password'], msg: 'Field required' }] }, { status: 422 }),
    )
    await expect(api('/x', { method: 'POST' })).rejects.toMatchObject({
      status: 422,
      message: 'Field required',
      detail: [{ type: 'missing', loc: ['body', 'password'], msg: 'Field required' }],
    })
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    await expect(api('/x')).rejects.toMatchObject({ status: 500, message: expect.stringContaining('Erreur du serveur (500)') })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(api('/x')).rejects.toMatchObject({ status: 0, message: expect.stringContaining('Serveur injoignable') })
    expect(toast.error).not.toHaveBeenCalled()
  })
})
