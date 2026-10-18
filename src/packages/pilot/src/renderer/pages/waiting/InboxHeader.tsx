import { ChevronDown, ChevronsUpDown, PanelLeft } from 'lucide-react'

export const ALL = 'all'

// Also the Playground's project picker.
export function Select({
  label,
  prefix,
  value,
  onChange,
  disabled,
  children
}: {
  label: string
  prefix?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label className="relative inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[13px]">
      {prefix ? <span className="text-muted-foreground">{prefix}</span> : null}
      <select
        aria-label={label}
        value={value}
        disabled={disabled}
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
  people,
  viewer,
  onViewer,
  wide,
  canExpand,
  allOpen,
  onToggleAll
}: {
  listOpen: boolean
  onToggleList: () => void
  people: { id: string; name: string }[]
  viewer: string | null
  onViewer: (id: string) => void
  // The page is wide enough for the list beside the cards; only then is the fold button shown.
  wide: boolean
  // Whether any card has Details, and whether they are all open.
  canExpand: boolean
  allOpen: boolean
  onToggleAll: () => void
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
      {wide ? (
        <button
          type="button"
          aria-label={listOpen ? 'Hide the card list' : 'Show the card list'}
          aria-expanded={listOpen}
          onClick={onToggleList}
          className="inline-grid size-8 place-items-center rounded-md border border-border bg-card hover:bg-muted"
        >
          <PanelLeft aria-hidden className="size-4" />
        </button>
      ) : null}
      <div className="flex flex-1 items-center gap-2">
        <h2 className="text-lg font-semibold">Inbox</h2>
      </div>
      {canExpand ? (
        <button
          type="button"
          onClick={onToggleAll}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-[13px] hover:bg-muted"
        >
          <ChevronsUpDown aria-hidden className="size-3.5" />
          {allOpen ? 'Collapse all details' : 'Expand all details'}
        </button>
      ) : null}
      <Select label="Viewing as" prefix="Viewing as" value={viewer ?? ''} onChange={onViewer}>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
    </header>
  )
}
