import { LayoutGrid, List, Maximize2 } from 'lucide-react'
import type { InboxType } from '../../../shared/api-types'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Select } from './InboxHeader'
import { INBOX_KINDS, type CardFilters } from './inbox-tabs'
import type { InboxGroupBy, InboxSort, InboxView } from './inbox-view-prefs'

const GROUP_OPTIONS: readonly { value: InboxGroupBy; label: string }[] = [
  { value: 'worktree', label: 'Worktree' },
  { value: 'job', label: 'Job' },
  { value: 'kind', label: 'Kind' },
  { value: 'age', label: 'Age' },
  { value: 'none', label: 'Nothing' }
]

const SORT_OPTIONS: readonly { value: InboxSort; label: string }[] = [
  { value: 'kind', label: 'Kind, then oldest' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'newest', label: 'Newest first' }
]

const VIEW_OPTIONS: readonly {
  value: InboxView
  label: string
  icon: typeof List
}[] = [
  { value: 'cards', label: 'Cards', icon: LayoutGrid },
  { value: 'rows', label: 'Rows', icon: List },
  { value: 'focus', label: 'One at a time', icon: Maximize2 }
]

export function InboxFilters({
  filters,
  kindCounts,
  shown,
  total,
  group,
  sort,
  view,
  onFilters,
  onGroup,
  onSort,
  onView
}: {
  filters: CardFilters
  kindCounts: Partial<Record<InboxType, number>>
  shown: number
  total: number
  group: InboxGroupBy
  sort: InboxSort
  view: InboxView
  onFilters: (filters: CardFilters) => void
  onGroup: (group: InboxGroupBy) => void
  onSort: (sort: InboxSort) => void
  onView: (view: InboxView) => void
}): React.JSX.Element {
  const toggleKind = (type: InboxType): void => {
    const kinds = filters.kinds.includes(type)
      ? filters.kinds.filter((kind) => kind !== type)
      : [...filters.kinds, type]
    onFilters({ ...filters, kinds })
  }
  const filtered = filters.kinds.length > 0 || filters.query.trim() !== ''
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <Input
        type="search"
        aria-label="Search cards"
        placeholder="Search cards"
        value={filters.query}
        onChange={(e) => onFilters({ ...filters, query: e.target.value })}
        className="w-56"
      />
      <div role="group" aria-label="Kind" className="flex flex-wrap items-center gap-1.5">
        {INBOX_KINDS.filter(
          ({ type }) => (kindCounts[type] ?? 0) > 0 || filters.kinds.includes(type)
        ).map(({ type, label }) => {
          const on = filters.kinds.includes(type)
          return (
            <button
              key={type}
              type="button"
              aria-pressed={on}
              onClick={() => toggleKind(type)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold',
                on
                  ? 'border-transparent bg-[var(--ib-accent-soft)] text-[var(--ib-accent)]'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              )}
            >
              {label} · {kindCounts[type] ?? 0}
            </button>
          )
        })}
        {filtered ? (
          <button
            type="button"
            onClick={() => onFilters({ kinds: [], query: '' })}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear · {shown} of {total} shown
          </button>
        ) : null}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <Select
          label="Group by"
          prefix="Group by"
          value={group}
          onChange={(value) => {
            const next = GROUP_OPTIONS.find((option) => option.value === value)
            if (next) {
              onGroup(next.value)
            }
          }}
        >
          {GROUP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Select
          label="Sort"
          prefix="Sort"
          value={sort}
          onChange={(value) => {
            const next = SORT_OPTIONS.find((option) => option.value === value)
            if (next) {
              onSort(next.value)
            }
          }}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <div role="group" aria-label="View" className="inline-flex gap-1">
          {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              aria-label={label}
              title={label}
              onClick={() => onView(value)}
              className={cn(
                'inline-grid size-8 place-items-center rounded-md border',
                view === value
                  ? 'border-transparent bg-[var(--ib-accent-soft)] text-[var(--ib-accent)]'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon aria-hidden className="size-4" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
