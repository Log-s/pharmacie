import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Me } from '@/auth/session'
import { FormRenderer, type FormRendererProps, serverFieldErrors } from '@/forms/renderer'
import { ApiError, meQueryKey, queryClient } from '@/lib/api'
import { templateTree, type TemplateTree } from '@/templates/schema'

// jsdom lacks it; Radix checkbox/radio measure themselves with it.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const ID = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
const ANNEX = '0d9b3f52-55a4-4d0e-9f0e-3b1c2a7d0001'
const tree: TemplateTree = templateTree.parse({
  nodes: [
    { id: ID(1), type: 'reference', label: 'Référence' },
    { id: ID(2), type: 'date', label: 'Date du contrôle', required: true },
    { id: ID(3), type: 'author', label: 'Auteur' },
    {
      id: ID(4),
      type: 'category',
      label: 'Contrôle',
      children: [
        {
          id: ID(5),
          type: 'checkbox_group',
          label: 'Vérifications',
          help: 'Cochez ce qui a été vérifié.',
          annex_ref: { annex_id: ANNEX },
          options: [
            { id: ID(6), label: 'Étiquette' },
            { id: ID(7), label: 'Écart constaté', children: [{ id: ID(8), type: 'text', label: 'Description', required: true, max_length: 10 }] },
          ],
        },
        {
          id: ID(9),
          type: 'radio_group',
          label: 'Résultat',
          required: true,
          options: [
            { id: ID(10), label: 'Conforme' },
            { id: ID(11), label: 'Non conforme', children: [{ id: ID(12), type: 'text', label: 'Action', multiline: true }] },
          ],
        },
      ],
    },
    { id: ID(13), type: 'text', label: 'Commentaire', help: 'Facultatif.' },
  ],
})

const profile = { id: 'p1', display_name: 'Claire Martin', initials: 'CM', color: '#2f855a', archived_at: null }
const me: Me = { role: 'user', active_profile: profile, csrf_token: 'csrf' }

function renderForm(props: Partial<FormRendererProps> = {}) {
  const onSubmit = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <FormRenderer tree={tree} onSubmit={onSubmit} {...props}>
        <button type="submit">Enregistrer</button>
      </FormRenderer>
    </QueryClientProvider>,
  )
  return onSubmit
}

beforeEach(() => {
  queryClient.setQueryData(meQueryKey, me)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url === '/api/profiles' ? Response.json([profile, { ...profile, id: 'p2', display_name: 'Paul Roux', initials: 'PR' }]) : Response.json({ reference: '10-2026-042' }),
    ),
  )
})
afterEach(() => {
  queryClient.clear()
  vi.unstubAllGlobals()
})

const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }))

describe('FormRenderer (edit)', () => {
  test('renders category sections, groups, help and the annex « i » after the label', async () => {
    renderForm()
    expect(screen.getByRole('heading', { level: 2, name: /Contrôle/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /Contrôle/ })).toBeInTheDocument()
    const checks = screen.getByRole('group', { name: /Vérifications/ })
    expect(within(checks).getAllByRole('checkbox')).toHaveLength(2)
    expect(within(checks).getByText('Cochez ce qui a été vérifié.')).toBeInTheDocument()
    const annex = within(checks).getByRole('link', { name: 'Annexe : Vérifications' })
    expect(annex).toHaveAttribute('href', `/api/annexes/${ANNEX}/file`)
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByText('Résultat').parentElement).toHaveTextContent('Résultat* (obligatoire)')
  })

  test('option children are shown only while the option is selected', () => {
    renderForm()
    expect(screen.queryByLabelText(/Description/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Écart constaté' }))
    expect(screen.getByLabelText(/Description/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Écart constaté' }))
    expect(screen.queryByLabelText(/Description/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Action/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Non conforme' }))
    expect(screen.getByLabelText(/Action/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: 'Conforme' }))
    expect(screen.queryByLabelText(/Action/)).not.toBeInTheDocument()
  })

  test('prefills date (today, French), author (active profile) and reference (next number)', async () => {
    renderForm()
    const today = format(new Date(), 'd MMMM yyyy', { locale: fr })
    expect(screen.getByRole('button', { name: /^Date du contrôle/ })).toHaveAccessibleName(new RegExp(`\\(obligatoire\\) ${today}$`))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Auteur' })).toHaveTextContent('Claire Martin'))
    await waitFor(() => expect(screen.getByLabelText('Référence')).toHaveValue('10-2026-042'))
  })

  test('validates the reference with the central format', async () => {
    const onSubmit = renderForm()
    await waitFor(() => expect(screen.getByLabelText('Référence')).toHaveValue('10-2026-042'))
    fireEvent.change(screen.getByLabelText('Référence'), { target: { value: '10-26-42' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Conforme' }))
    submit()
    expect(await screen.findByText(/Format attendu : MM-AAAA-NNN/)).toBeInTheDocument()
    expect(screen.getByLabelText('Référence')).toHaveAttribute('aria-invalid', 'true')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  test('text fields count characters against max_length', () => {
    renderForm()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Écart constaté' }))
    const description = screen.getByLabelText(/Description/)
    expect(description).toHaveAttribute('maxLength', '10')
    fireEvent.change(description, { target: { value: 'abc' } })
    expect(screen.getByText('3 / 10')).toBeInTheDocument()
  })

  test('required fields block the submit, only when visible', async () => {
    const onSubmit = renderForm()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Écart constaté' }))
    submit()
    expect(await screen.findByText('Choisissez une option.')).toBeInTheDocument()
    expect(screen.getByText('Ce champ est obligatoire.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Écart constaté' })) // hides Description: nothing to confirm
    fireEvent.click(screen.getByRole('radio', { name: 'Conforme' }))
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  })

  test('submits the U7 data format: visible values only, no empty strings, untouched reference = null', async () => {
    const onSubmit = renderForm()
    await waitFor(() => expect(screen.getByLabelText('Référence')).toHaveValue('10-2026-042'))
    fireEvent.click(screen.getByRole('radio', { name: 'Non conforme' }))
    fireEvent.change(screen.getByLabelText(/Action/), { target: { value: 'Retour fournisseur' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Conforme' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Effacer et continuer' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Étiquette' }))
    fireEvent.change(screen.getByLabelText('Commentaire'), { target: { value: '' } })
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toEqual({
      reference: null,
      data: { [ID(2)]: format(new Date(), 'yyyy-MM-dd'), [ID(3)]: 'p1', [ID(5)]: [ID(6)], [ID(9)]: ID(10) },
    })
  })

  test('a chosen reference is sent as typed', async () => {
    const onSubmit = renderForm()
    await waitFor(() => expect(screen.getByLabelText('Référence')).toHaveValue('10-2026-042'))
    fireEvent.change(screen.getByLabelText('Référence'), { target: { value: '10-2026-100' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Conforme' }))
    submit()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0].reference).toBe('10-2026-100')
  })

  test('unchecking an option with filled children asks first; cancel keeps everything', async () => {
    renderForm()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Écart constaté' }))
    fireEvent.change(screen.getByLabelText(/Description/), { target: { value: 'cassé' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Écart constaté' }))
    const dialog = await screen.findByRole('alertdialog', { name: /^Effacer les champs masqués\s\?$/ })
    expect(dialog).toHaveTextContent('« Description »')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Garder mon choix précédent' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText(/Description/)).toHaveValue('cassé')

    fireEvent.click(screen.getByRole('checkbox', { name: 'Écart constaté' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Effacer et continuer' }))
    await waitFor(() => expect(screen.queryByLabelText(/Description/)).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('checkbox', { name: 'Écart constaté' }))
    expect(screen.getByLabelText(/Description/)).toHaveValue('')
  })

  test('existing form: values loaded, no prefill, server errors shown on the field', async () => {
    const onSubmit = renderForm({
      defaultValue: { reference: '10-2026-007', data: { [ID(9)]: ID(11), [ID(12)]: 'Rappel' } },
      errors: { [ID(12)]: 'Texte refusé par le serveur.', reference: 'Cette référence est déjà utilisée par une autre fiche.' },
    })
    expect(screen.getByLabelText('Référence')).toHaveValue('10-2026-007')
    expect(screen.getByLabelText(/Action/)).toHaveValue('Rappel')
    expect(screen.getByRole('button', { name: /Date du contrôle/ })).toHaveTextContent('Choisir une date')
    expect(await screen.findByText('Texte refusé par le serveur.')).toBeInTheDocument()
    expect(screen.getByText('Cette référence est déjà utilisée par une autre fiche.')).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('FormRenderer (readonly)', () => {
  test('renders values as text, without inputs, hidden children left out', async () => {
    renderForm({
      mode: 'readonly',
      defaultValue: {
        reference: '10-2026-007',
        data: { [ID(2)]: '2026-10-24', [ID(3)]: 'p2', [ID(5)]: [ID(7)], [ID(8)]: 'Étiquette illisible', [ID(9)]: ID(10), [ID(12)]: 'caché' },
      },
    })
    expect(screen.queryAllByRole('textbox')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.getByText('10-2026-007')).toBeInTheDocument()
    expect(screen.getByText('24 octobre 2026')).toBeInTheDocument()
    expect(await screen.findByText('Paul Roux')).toBeInTheDocument()
    expect(screen.getByText('Écart constaté')).toBeInTheDocument()
    expect(screen.getByText('Étiquette illisible')).toBeInTheDocument()
    expect(screen.queryByText('caché')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Annexe : Vérifications' })).toBeInTheDocument()
    expect(screen.getAllByText('Non renseigné')).toHaveLength(1) // Commentaire
  })
})

describe('serverFieldErrors', () => {
  test('maps U7 422 locations and the 409 reference conflict', () => {
    const detail = [
      { type: 'value_error', loc: ['body', 'data', ID(8)], msg: '« Description » : 10 caractères au maximum.' },
      { type: 'value_error', loc: ['body', 'reference'], msg: 'Format de référence invalide.' },
    ]
    expect(serverFieldErrors(new ApiError(422, 'x', detail))).toEqual({ [ID(8)]: '10 caractères au maximum.', reference: 'Format de référence invalide.' })
    expect(serverFieldErrors(new ApiError(409, 'Cette référence est déjà utilisée par une autre fiche.'))).toEqual({
      reference: 'Cette référence est déjà utilisée par une autre fiche.',
    })
    expect(serverFieldErrors(new ApiError(422, 'Version inconnue.', 'Version inconnue.'))).toEqual({})
  })
})
