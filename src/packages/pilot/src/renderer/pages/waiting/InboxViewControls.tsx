import { LayoutGrid, List, Maximize2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Select } from './InboxHeader'
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

// Group by, Sort and the view buttons: in the header beside the list, else in the kind chips' row.
export function InboxViewControls({
  group,
  sort,
  view,
  onGroup,
  onSort,
  onView
}: {
  group: InboxGroupBy
  sort: InboxSort
  view: InboxView
  onGroup: (group: InboxGroupBy) => void
  onSort: (sort: InboxSort) => void
  onView: (view: InboxView) => void
}): React.JSX.Element {
  return (
    <>
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
    </>
  )
}
