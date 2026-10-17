import { cn } from '@/lib/utils'
import type { HostedSection } from '../../hosts/hosted-sections'
import { ALL } from './InboxHeader'

// The filter when the list is not beside the cards: one wrapping row of toggle buttons, "All" first, then
// the groups in the cards' order. Not sticky, so it never floats over scrolling content.
export function FilterBadges({
  sections,
  total,
  group,
  onGroup
}: {
  sections: HostedSection[]
  total: number
  group: string
  onGroup: (key: string) => void
}): React.JSX.Element {
  const badge = (key: string, label: string, count: number) => {
    const on = group === key
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        title={label}
        onClick={() => onGroup(key)}
        className={cn(
          'inline-flex max-w-[280px] items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold',
          on
            ? 'border-transparent bg-[var(--ib-accent-soft)] text-[var(--ib-accent)]'
            : 'border-border bg-card text-muted-foreground hover:text-foreground'
        )}
      >
        <span className="truncate">{label}</span>
        <span className="shrink-0">· {count}</span>
      </button>
    )
  }
  return (
    <div role="toolbar" aria-label="Filter by group" className="flex flex-wrap gap-1.5">
      {badge(ALL, 'All', total)}
      {sections.map((s) => badge(s.key, s.group.label, s.items.length))}
    </div>
  )
}
