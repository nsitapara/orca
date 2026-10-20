import { cn } from '@/lib/utils'
import type { InboxTab } from './inbox-tabs'

export function InboxTabs({
  tab,
  counts,
  preparingNote,
  onTab
}: {
  tab: InboxTab
  counts: Record<InboxTab, number>
  // Shown right after Preparing: how many of its cards wait on the runner.
  preparingNote: string | null
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
      {preparingNote ? (
        <span
          title="waiting for the runner"
          className="rounded-full bg-[var(--ib-bad-soft)] px-2 font-mono text-xs font-semibold leading-5 text-[var(--ib-bad)]"
        >
          {preparingNote}
        </span>
      ) : null}
      {/* Kept at 0 while it is the tab, so a Retry that empties it never leaves no tab pressed. */}
      {counts.blocked > 0 || tab === 'blocked'
        ? button('blocked', 'Blocked', counts.blocked)
        : null}
      {button('all', 'All', counts.all)}
    </div>
  )
}
