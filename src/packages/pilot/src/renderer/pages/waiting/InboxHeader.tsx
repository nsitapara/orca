import { ChevronDown, PanelLeft } from 'lucide-react'
import type { Section } from '../../../shared/inbox-groups'

export const ALL = 'all'

function Select({
  label,
  prefix,
  value,
  onChange,
  children
}: {
  label: string
  prefix?: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="relative inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[13px]">
      {prefix ? <span className="text-muted-foreground">{prefix}</span> : null}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-64 appearance-none truncate bg-transparent pr-4 outline-none"
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-2 size-3" />
    </label>
  )
}

export function InboxHeader({
  listOpen,
  onToggleList,
  waiting,
  people,
  viewer,
  onViewer,
  sections,
  total,
  group,
  onGroup
}: {
  listOpen: boolean
  onToggleList: () => void
  waiting: number
  people: { id: string; name: string }[]
  viewer: string | null
  onViewer: (id: string) => void
  sections: Section[]
  total: number
  group: string
  onGroup: (key: string) => void
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
      <button
        type="button"
        aria-label={listOpen ? 'Hide the card list' : 'Show the card list'}
        aria-expanded={listOpen}
        onClick={onToggleList}
        className="inline-grid size-8 place-items-center rounded-md border border-border bg-card hover:bg-muted"
      >
        <PanelLeft aria-hidden className="size-4" />
      </button>
      <div className="flex flex-1 items-center gap-2">
        <h2 className="text-lg font-semibold">Inbox</h2>
        <span className="rounded-full bg-muted px-2 font-mono text-xs font-semibold leading-5 text-muted-foreground">
          {waiting} waiting
        </span>
      </div>
      <Select label="Viewing as" prefix="Viewing as" value={viewer ?? ''} onChange={onViewer}>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      <Select label="Worktree filter" value={group} onChange={onGroup}>
        <option value={ALL}>All worktrees · {total}</option>
        {sections.map((s) => (
          <option key={s.group.key} value={s.group.key}>
            {s.group.label} · {s.items.length}
          </option>
        ))}
      </Select>
    </header>
  )
}
