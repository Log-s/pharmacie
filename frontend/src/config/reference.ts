// Form reference format (spec §3.2). Provisional: FIXME-\d{6}.
// Mirror of backend/app/config/reference.py: change both together, nowhere else.
export const REFERENCE_PREFIX = 'FIXME'
export const REFERENCE_DIGITS = 6
export const REFERENCE_RE = new RegExp(`^${REFERENCE_PREFIX}-[0-9]{${REFERENCE_DIGITS}}$`)
export const REFERENCE_EXAMPLE = `${REFERENCE_PREFIX}-${'42'.padStart(REFERENCE_DIGITS, '0')}`

export function isValidReference(value: string): boolean {
  return REFERENCE_RE.test(value)
}
