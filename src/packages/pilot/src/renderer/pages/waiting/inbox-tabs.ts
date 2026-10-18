import type { InboxListRow, InboxType } from '../../../shared/api-types'
import type { AnswerState } from '../../../shared/inbox-types'

export type InboxTab = 'needs_you' | 'preparing' | 'blocked' | 'all' | 'done'
export type CardFilters = { kinds: readonly InboxType[]; query: string }

export const INBOX_KINDS: readonly { type: InboxType; label: string }[] = [
  { type: 'question', label: 'Questions' },
  { type: 'action', label: 'Approvals' },
  { type: 'bug', label: 'Bugs' },
  { type: 'flagged', label: 'Flagged' },
  { type: 'left_for_you', label: 'Left for you' }
]

function inNeedsYou(item: InboxListRow, answer: AnswerState | null): boolean {
  if (item.status === 'open') {
    const state = item.preparation?.state
    return state === undefined || state === 'ready' || state === 'cancelled'
  }
  if (item.status === 'answered') {
    // Unlocked keeps Undo on screen; a failed answer needs another go. Sent before Pilot never locks.
    return (
      answer !== null && ((!answer.locked && !answer.sentBeforePilot) || answer.state === 'failed')
    )
  }
  return false
}

export function inTab(
  item: InboxListRow,
  tab: Exclude<InboxTab, 'done'>,
  answer: AnswerState | null
): boolean {
  if (item.type === 'default') {
    return false
  }
  switch (tab) {
    case 'all':
      return true
    case 'needs_you':
      return inNeedsYou(item, answer)
    case 'preparing':
      return (
        item.status === 'open' &&
        (item.preparation?.state === 'queued' || item.preparation?.state === 'generating')
      )
    case 'blocked':
      return item.status === 'open' && item.preparation?.state === 'blocked'
  }
}

// Counts have no answer states, so they match waitingCount: only open cards count as Needs you.
export function tabCounts(
  items: InboxListRow[]
): Record<'needs_you' | 'preparing' | 'blocked' | 'all', number> {
  const count = (tab: Exclude<InboxTab, 'done'>): number =>
    items.filter((item) => inTab(item, tab, null)).length
  return {
    needs_you: count('needs_you'),
    preparing: count('preparing'),
    blocked: count('blocked'),
    all: count('all')
  }
}

export function matchesFilters(
  item: InboxListRow,
  filters: CardFilters,
  groupLabel: string
): boolean {
  if (filters.kinds.length > 0 && !filters.kinds.includes(item.type)) {
    return false
  }
  const query = filters.query.trim().toLowerCase()
  if (!query) {
    return true
  }
  return [item.title, item.context, item.itemLabel, groupLabel].some((text) =>
    text?.toLowerCase().includes(query)
  )
}

const EMPTY_TAB_TEXT: Record<'preparing' | 'blocked' | 'all', string> = {
  preparing: 'Nothing is preparing context.',
  blocked: 'No preparation is blocked.',
  all: 'No cards here.'
}

// What an empty tab says; a chip or search on a card tab names the filters, not the tab.
export function emptyTabText(tab: InboxTab, filtered: boolean, viewerName: string): string {
  if (tab === 'done') {
    return `Nothing done for ${viewerName} here.`
  }
  if (filtered) {
    return 'No cards match these filters.'
  }
  if (tab === 'needs_you') {
    return `Nothing waiting on ${viewerName} here.`
  }
  return EMPTY_TAB_TEXT[tab]
}

export function kindCounts(items: InboxListRow[]): Partial<Record<InboxType, number>> {
  const counts: Partial<Record<InboxType, number>> = {}
  for (const item of items) {
    counts[item.type] = (counts[item.type] ?? 0) + 1
  }
  return counts
}

const TAB_LABELS: Record<InboxTab, string> = {
  needs_you: 'Needs you',
  preparing: 'Preparing',
  blocked: 'Blocked',
  all: 'All',
  done: 'Done for you'
}

export function tabLabel(tab: InboxTab): string {
  return TAB_LABELS[tab]
}

// Only preparing cards count; a wait on any other card is not the runner's line.
export function preparingNote<T extends InboxListRow>(
  items: T[],
  isWaiting: (item: T) => boolean
): string | null {
  const n = items.filter((item) => inTab(item, 'preparing', null) && isWaiting(item)).length
  return n > 0 ? `${n} waiting` : null
}
