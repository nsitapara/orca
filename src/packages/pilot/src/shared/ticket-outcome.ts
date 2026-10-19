import type { InboxItemRow } from './api-types'
import type { TicketedRef } from './ticket-types'

export const OUTCOME_PREFIX = 'ticketed for later: '
const OUTCOME_SEPARATOR = ' · '
const LOCATION_SUFFIX = /\s—\s(\S+:\d+(?:-\d+)?)$/

export function formatTicketedOutcome(ref: TicketedRef): string {
  return `${OUTCOME_PREFIX}${ref.identifier}${OUTCOME_SEPARATOR}${ref.url}`
}

export function parseTicketedOutcome(outcome: string | null): TicketedRef | null {
  if (!outcome?.startsWith(OUTCOME_PREFIX)) {
    return null
  }
  const rest = outcome.slice(OUTCOME_PREFIX.length)
  const at = rest.indexOf(OUTCOME_SEPARATOR)
  if (at <= 0) {
    return null
  }
  const identifier = rest.slice(0, at)
  const url = rest.slice(at + OUTCOME_SEPARATOR.length)
  return url ? { identifier, url } : null
}

// Splits off the " — <file>:<line>" suffix that --location appends.
export function findingTitle(title: string): { title: string; location: string | null } {
  const match = LOCATION_SUFFIX.exec(title)
  if (!match) {
    return { title, location: null }
  }
  return { title: title.slice(0, match.index), location: match[1] }
}

export function ticketRefusal(
  card: Pick<InboxItemRow, 'status' | 'type' | 'itemKey'>
): string | null {
  if (card.status === 'answered') {
    return 'This card is already answered'
  }
  if (card.type === 'action') {
    return "An action card's Approve is its effect"
  }
  if (card.itemKey === null) {
    return "This card has no item key, so it can't be filed"
  }
  return null
}
