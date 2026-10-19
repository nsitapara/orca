import type { InboxItemRow } from '../../shared/api-types'
import { findingTitle, parseTicketedOutcome } from '../../shared/ticket-outcome'
import type { TicketedRef } from '../../shared/ticket-types'
import type { PilotStore } from '../store/store'

// Keyed by card id: the newest done card of the same automation, item key and finding title that was ticketed for later.
export function ticketedBeforeFor(
  store: PilotStore,
  cards: readonly InboxItemRow[]
): Map<string, TicketedRef> {
  const found = new Map<string, TicketedRef>()
  const doneByKey = new Map<string, InboxItemRow[]>()
  for (const card of cards) {
    if (card.itemKey === null) {
      continue
    }
    const key = JSON.stringify([card.automationId, card.itemKey])
    let done = doneByKey.get(key)
    if (!done) {
      done = store.inbox
        .list({ automationId: card.automationId, itemKey: card.itemKey, status: ['done'] })
        .filter((d) => parseTicketedOutcome(d.outcome))
        .sort((a, b) => b.updatedAt - a.updatedAt)
      doneByKey.set(key, done)
    }
    const title = findingTitle(card.title).title
    const match = done.find((d) => findingTitle(d.title).title === title)
    const ref = match && parseTicketedOutcome(match.outcome)
    if (ref) {
      found.set(card.id, ref)
    }
  }
  return found
}
