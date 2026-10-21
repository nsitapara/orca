import type { InboxListRow, InboxType } from '../../../shared/api-types'

export type CardFilters = { kinds: readonly InboxType[] }

export const INBOX_KINDS: readonly { type: InboxType; label: string }[] = [
  { type: 'question', label: 'Questions' },
  { type: 'action', label: 'Approvals' },
  { type: 'bug', label: 'Bugs' },
  { type: 'flagged', label: 'Flagged' },
  { type: 'left_for_you', label: 'Left for you' }
]

export function matchesFilters(item: InboxListRow, filters: CardFilters): boolean {
  return filters.kinds.length === 0 || filters.kinds.includes(item.type)
}

// What an empty Inbox says; a picked kind names the filters.
export function emptyInboxText(filtered: boolean, viewerName: string): string {
  return filtered ? 'No cards match these filters.' : `Nothing waiting on ${viewerName} here.`
}

export function kindCounts(items: InboxListRow[]): Partial<Record<InboxType, number>> {
  const counts: Partial<Record<InboxType, number>> = {}
  for (const item of items) {
    counts[item.type] = (counts[item.type] ?? 0) + 1
  }
  return counts
}
