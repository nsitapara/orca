import type { InboxListRow } from '../../shared/api-types'
import { byCard, KIND_ORDER, type InboxGroup } from '../../shared/inbox-groups'
import type { InboxListPayload } from '../../shared/inbox-types'
import { jobCode } from '../pages/waiting/answer-text'
import { INBOX_KINDS } from '../pages/waiting/inbox-tabs'
import type { InboxGroupBy, InboxSort } from '../pages/waiting/inbox-view-prefs'
import { groupHostedItems, type HostedSection } from './hosted-sections'
import type { Hosted } from './pilot-host'

const HOUR = 3_600_000
const AGE_BUCKETS = [
  { label: 'Last hour', under: HOUR },
  { label: 'Today', under: 24 * HOUR },
  { label: 'This week', under: 7 * 24 * HOUR },
  { label: 'Older', under: Number.POSITIVE_INFINITY }
] as const
const OTHER_KIND = 'Other'
const JOB_ORDER = new Intl.Collator(undefined, { numeric: true })

type Bucket = { key: string; label: string; rank: number; order: string }

function kindBucket(item: InboxListRow): Bucket {
  const label = INBOX_KINDS.find((k) => k.type === item.type)?.label ?? OTHER_KIND
  const at = KIND_ORDER.indexOf(item.type)
  const rank = at === -1 ? KIND_ORDER.length : at
  return { key: `kind:${label}`, label, rank, order: '' }
}

function ageBucket(item: InboxListRow, now: number): Bucket {
  const age = now - item.createdAt
  const at = AGE_BUCKETS.findIndex((b) => age < b.under)
  const label = AGE_BUCKETS[at].label
  return { key: `age:${label}`, label, rank: at, order: '' }
}

function jobBucket(item: InboxListRow, automations: InboxListPayload['automations']): Bucket {
  const name = automations.find((a) => a.id === item.automationId)?.name ?? item.automationId
  const order = jobCode(name, item.automationId)
  return { key: `job:${item.automationId}`, label: name, rank: 0, order }
}

function bucketOf(
  item: InboxListRow,
  automations: InboxListPayload['automations'],
  group: Exclude<InboxGroupBy, 'worktree'>,
  now: number
): Bucket {
  if (group === 'job') {
    return jobBucket(item, automations)
  }
  if (group === 'kind') {
    return kindBucket(item)
  }
  if (group === 'age') {
    return ageBucket(item, now)
  }
  return { key: 'all', label: '', rank: 0, order: '' }
}

function byChosenSort(sort: InboxSort): (a: InboxListRow, b: InboxListRow) => number {
  if (sort === 'oldest') {
    return (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  }
  if (sort === 'newest') {
    return (a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)
  }
  return byCard
}

// Non-worktree groups use keys that don't start with `wt:`, so the headings render no worktree link. They span
// machines: a job, kind or age is one heading however many machines have cards in it.
function sectionsByBucket(
  items: readonly Hosted<InboxListRow>[],
  automations: InboxListPayload['automations'],
  group: Exclude<InboxGroupBy, 'worktree'>,
  now: number
): (HostedSection & { order: string })[] {
  const buckets = new Map<string, Bucket & { items: Hosted<InboxListRow>[] }>()
  for (const item of items) {
    const bucket = bucketOf(item, automations, group, now)
    const entry = buckets.get(bucket.key) ?? { ...bucket, items: [] }
    entry.items.push(item)
    buckets.set(bucket.key, entry)
  }
  return [...buckets.values()].map((b) => {
    const inboxGroup: InboxGroup = { key: b.key, label: b.label, rank: b.rank }
    // Only a worktree heading reads its host; each card keeps its own.
    return { key: b.key, host: b.items[0].host, group: inboxGroup, items: b.items, order: b.order }
  })
}

// Worktree sections per machine; the other modes across machines. Sections and cards in the chosen order.
export function groupHostedItemsBy(
  items: Hosted<InboxListRow>[],
  automations: InboxListPayload['automations'],
  group: InboxGroupBy,
  sort: InboxSort,
  now: number
): HostedSection[] {
  const compareCards = byChosenSort(sort)
  if (group === 'worktree') {
    return groupHostedItems(items, automations).map((s) => ({
      ...s,
      items: [...s.items].sort(compareCards)
    }))
  }
  return sectionsByBucket(items, automations, group, now)
    .sort((a, b) => a.group.rank - b.group.rank || JOB_ORDER.compare(a.order, b.order))
    .map(({ order: _order, ...section }) => ({
      ...section,
      items: [...section.items].sort(compareCards)
    }))
}
