import type { InboxItemRow } from './api-types'
import { PREPARATION_NOT_READY } from './preparation'

// R-P5: an evidence-needing decision runs only from a prepared card whose preparation is ready and verified. The
// decisions are the actions whose Approve runs with no agent in between, and applying a drafted code change. The
// rule reads the card (its action and Details), never who added it or how its caller is bound.
export const EVIDENCE_ACTIONS: ReadonlySet<string> = new Set(['push'])
export const NEEDS_EVIDENCE =
  'This decision needs prepared evidence first: use Prepare evidence, then approve it once its context is ready'

export function needsEvidence(card: Pick<InboxItemRow, 'action' | 'details'>): boolean {
  return (
    (card.action !== null && EVIDENCE_ACTIONS.has(card.action)) || card.details?.drafted === true
  )
}

// Why the card's approval can't run now, or null: a prepared card until its preparation is ready (whatever it
// decides), and an evidence-needing card that was never prepared.
export function evidenceGate(
  card: Pick<InboxItemRow, 'action' | 'details' | 'preparation'>
): string | null {
  if (card.preparation) {
    return card.preparation.state === 'ready' ? null : PREPARATION_NOT_READY
  }
  return needsEvidence(card) ? NEEDS_EVIDENCE : null
}
