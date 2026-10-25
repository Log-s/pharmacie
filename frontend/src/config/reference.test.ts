import { describe, expect, test } from 'vitest'
import { isValidReference, REFERENCE_EXAMPLE, REFERENCE_HINT } from '@/config/reference'

describe('reference format (mirror of backend/app/config/reference.py)', () => {
  test.each(['10-2026-001', '10-2026-042', '01-1999-999', '12-2026-100', '10-2026-1000', '10-2026-12345'])('accepts %s', (value) => {
    expect(isValidReference(value)).toBe(true)
  })

  test.each([
    'FIX' + 'ME-000042', // the provisional format
    '13-2026-001',
    '00-2026-001',
    '10-2026-0001',
    '10-2026-01',
    '10-26-001',
    '1-2026-001',
    '10-2026-00a',
    '10-2026-001\n',
    ' 10-2026-001',
    '10/2026/001',
    '',
  ])('rejects %j', (value) => {
    expect(isValidReference(value)).toBe(false)
  })

  test('example is valid and hint is French', () => {
    expect(isValidReference(REFERENCE_EXAMPLE)).toBe(true)
    expect(REFERENCE_EXAMPLE).toMatch(/-042$/)
    expect(REFERENCE_HINT).toBe('MM-AAAA-NNN')
  })
})
