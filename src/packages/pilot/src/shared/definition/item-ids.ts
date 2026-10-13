import type { ItemKind } from './types'

// A Linear identifier as Linear writes it: the team key, a dash and the number (WEB-123).
const LINEAR_ID = /^[A-Z][A-Z0-9]*-\d+$/
const PRINTABLE = /^[\x21-\x7e]+$/
export const MAX_FED_ID_LENGTH = 40
// One run hands a stage at most this many ids; past it the rest are refused.
export const MAX_FED_IDS_PER_RUN = 25

// Why <id> can't be handed to a stage whose items are <kind> (null: no such stage loaded), or null when it can. The
// sender checks it before writing a handover, and the receiver again before its source reads one.
export function fedIdProblem(kind: ItemKind | null, id: string): string | null {
  if (kind === null) {
    return 'its stage is not loaded'
  }
  if (id.length > MAX_FED_ID_LENGTH) {
    return `longer than ${MAX_FED_ID_LENGTH} characters`
  }
  if (kind === 'linear_ticket') {
    return LINEAR_ID.test(id) ? null : 'not a Linear id like WEB-123'
  }
  return PRINTABLE.test(id) ? null : 'not printable text without spaces'
}
