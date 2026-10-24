import { describe, expect, test } from 'vitest'
import { isValidReference, REFERENCE_EXAMPLE } from '@/config/reference'

describe('reference format (mirror of backend/app/config/reference.py)', () => {
  test.each(['FIXME-000042', 'FIXME-000000', 'FIXME-999999'])('accepts %s', (value) => {
    expect(isValidReference(value)).toBe(true)
  })

  test.each(['FIXME-42', 'fixme-000042', 'FIXME-0000421', 'FIXME000042', ' FIXME-000042', 'FIXME-000042\n', 'FIXME-00004a', ''])(
    'rejects %j',
    (value) => {
      expect(isValidReference(value)).toBe(false)
    },
  )

  test('example is valid', () => {
    expect(REFERENCE_EXAMPLE).toBe('FIXME-000042')
  })
})
