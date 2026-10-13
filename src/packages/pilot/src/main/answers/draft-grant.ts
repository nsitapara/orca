import { answerWord, APPROVE } from '../../shared/answers/route'
import type { InboxAnswer, InboxItemRow, InboxType } from '../../shared/api-types'
import type { DetailsRef } from '../../shared/details'
import { oneLine } from '../inbox/card'

// The kinds whose Approve asks for the drafted change; a question asks for it by picking the option drafted.
const APPROVES_DRAFT: ReadonlySet<InboxType> = new Set(['bug', 'left_for_you'])

function sameLabel(a: string, b: string): boolean {
  return oneLine(a).toLowerCase() === oneLine(b).toLowerCase()
}

// A question card's answer picked the option its bundle's Drafted row names (an option chosen, not typed).
export function picksDraftedOption(
  item: Pick<InboxItemRow, 'options' | 'details'>,
  answer: Pick<InboxAnswer, 'option'>
): boolean {
  const drafted = item.details?.draftedOption
  if (!drafted || answer.option === null || answer.option === undefined) {
    return false
  }
  const label = item.options[answer.option]?.label
  return label !== undefined && sameLabel(label, drafted)
}

// The answer asks for the drafted change as drafted: an Approve on a bug or left_for_you card, or a pick
// of the drafted option on a question. Any other words ("apply it", "yes" on a question) don't.
function asksForDraft(item: InboxItemRow, answer: InboxAnswer): boolean {
  if (item.type === 'question') {
    return picksDraftedOption(item, answer)
  }
  return APPROVES_DRAFT.has(item.type) && APPROVE.has(answerWord(answer.text ?? ''))
}

// Whether the card's current answer grants its drafted patch, from Pilot's own record and never from the
// answer's words: given in Pilot's window on this Mac (the transport's stamp), against the version shown
// now, still answered, and asking for the draft as drafted. apply.md applies a Pilot card's patch only
// when `pilot inbox show` says so.
export function draftApproved(item: InboxItemRow): boolean {
  // R-P5: a drafted change is approved only on a prepared card whose preparation is ready (D1).
  if (item.preparation?.state !== 'ready') {
    return false
  }
  const answer = item.answer
  if (!item.details?.drafted || !answer || item.status !== 'answered') {
    return false
  }
  if (answer.callerKind !== 'desktop' || answer.digest !== item.digest) {
    return false
  }
  return asksForDraft(item, answer)
}

export type ShownInboxItem = Omit<InboxItemRow, 'details'> & {
  details: (DetailsRef & { draftApproved: boolean }) | null
}

// One card as `pilot inbox show` gives it: its Details ref carries the grant.
export function shownItem(item: InboxItemRow): ShownInboxItem {
  if (!item.details) {
    return { ...item, details: null }
  }
  return { ...item, details: { ...item.details, draftApproved: draftApproved(item) } }
}
