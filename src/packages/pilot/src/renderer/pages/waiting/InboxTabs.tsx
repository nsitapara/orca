import { cn } from '@/lib/utils'
import type { InboxTab } from './inbox-tabs'

type TabCounts = Record<'needs_you' | 'preparing' | 'blocked' | 'all', number>

export function InboxTabs({
  tab,
  counts,
  preparingNote,
  doneCount,
  onTab
}: {
  tab: InboxTab
  counts: TabCounts
  // Shown beside the tabs, e.g. how many waiting cards are still being prepared.
  preparingNote: string | null
  doneCount: number
  onTab: (tab: InboxTab) => void
}): React.JSX.Element {
  const button = (key: InboxTab, label: string, count: number) => {
    const on = tab === key
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        onClick={() => onTab(key)}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold',
          on
            ? 'border-transparent bg-[var(--ib-accent-soft)] text-[var(--ib-accent)]'
            : 'border-border bg-card text-muted-foreground hover:text-foreground'
        )}
      >
        {label} · {count}
      </button>
    )
  }
  return (
    <div role="toolbar" aria-label="Card status" className="flex flex-wrap items-center gap-1.5">
      {button('needs_you', 'Needs you', counts.needs_you)}
      {button('preparing', 'Preparing', counts.preparing)}
      {counts.blocked > 0 ? button('blocked', 'Blocked', counts.blocked) : null}
      {button('all', 'All', counts.all)}
      {preparingNote ? (
        <span className="rounded-full bg-[var(--ib-bad-soft)] px-2 font-mono text-xs font-semibold leading-5 text-[var(--ib-bad)]">
          {preparingNote}
        </span>
      ) : null}
      <span aria-hidden className="mx-1 h-4 w-px bg-border" />
      {button('done', 'Done for you', doneCount)}
    </div>
  )
}
