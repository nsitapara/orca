import type { InboxItemRow } from '../../shared/api-types'
import { findingTitle, parseTicketedOutcome } from '../../shared/ticket-outcome'
import type { TicketedRef } from '../../shared/ticket-types'
import type { PilotStore } from '../store/store'

type Ticketed = { title: string; ref: TicketedRef; updatedAt: number }

// Keyed by card id: the newest done card of the same automation, item key and finding title that was ticketed for later.
export function ticketedBeforeFor(
  store: PilotStore,
  cards: readonly InboxItemRow[]
): Map<string, TicketedRef> {
  const found = new Map<string, TicketedRef>()
  if (cards.length === 0) {
    return found
  }
  const byKey = new Map<string, Ticketed[]>()
  for (const row of store.inbox.ticketedDone()) {
    const ref = parseTicketedOutcome(row.outcome)
    if (!ref) {
      continue
    }
    const key = JSON.stringify([row.automationId, row.itemKey])
    const entry = { title: findingTitle(row.title).title, ref, updatedAt: row.updatedAt }
    byKey.set(key, [...(byKey.get(key) ?? []), entry])
  }
  for (const card of cards) {
    const entries = byKey.get(JSON.stringify([card.automationId, card.itemKey]))
    const title = findingTitle(card.title).title
    let best: Ticketed | undefined
    for (const entry of entries ?? []) {
      if (entry.title === title && (!best || entry.updatedAt > best.updatedAt)) {
        best = entry
      }
    }
    if (best) {
      found.set(card.id, best.ref)
    }
  }
  return found
}
