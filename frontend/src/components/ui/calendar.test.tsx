import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Calendar } from '@/components/ui/calendar'

test('le calendrier a des libellés de navigation en français par défaut', () => {
  render(<Calendar mode="single" />)
  expect(screen.getByRole('button', { name: 'Aller au mois précédent' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Aller au mois suivant' })).toBeTruthy()
})
