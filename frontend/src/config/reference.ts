import { format } from 'date-fns'

// Form reference format (spec §3.2): MM-YYYY-NNN, the sequence restarting at 001 each month.
// NNN is 3 zero-padded digits, or 4+ digits without a leading zero past 999.
// Mirror of backend/app/config/reference.py: change both together, nowhere else.
export const REFERENCE_HINT = 'MM-AAAA-NNN'
export const REFERENCE_RE = /^(0[1-9]|1[0-2])-[0-9]{4}-([0-9]{3}|[1-9][0-9]{3,})$/
export const REFERENCE_EXAMPLE = `${format(new Date(), 'MM-yyyy')}-042`

export function isValidReference(value: string): boolean {
  return REFERENCE_RE.test(value)
}
