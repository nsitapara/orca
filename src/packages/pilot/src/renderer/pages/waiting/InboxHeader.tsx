import { ChevronDown, ChevronsDownUp, ChevronsUpDown, PanelLeft } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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

// One row beside the list: the title and the view controls; the controls wrap under it when narrow.
export function InboxHeader({
  listOpen,
  onToggleList,
  wide,
  canExpand,
  allOpen,
  onToggleAll,
  controls
}: {
  listOpen: boolean
  onToggleList: () => void
  // The page is wide enough for the list beside the cards; only then is the fold button shown.
  wide: boolean
  // Whether any card has Details, and whether they are all open.
  canExpand: boolean
  allOpen: boolean
  onToggleAll: () => void
  // Group by, Sort and the views, while the list holds the kinds; else they sit in the kind chips' row.
  controls: React.ReactNode
}): React.JSX.Element {
  const toggleAllLabel = allOpen ? 'Collapse all details' : 'Expand all details'
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
      <div className="flex items-center gap-3">
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
        <h2 className="text-lg font-semibold">Inbox</h2>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {controls}
        {canExpand ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={toggleAllLabel}
                onClick={onToggleAll}
                className="inline-grid size-8 place-items-center rounded-md border border-border bg-card text-muted-foreground hover:text-foreground"
              >
                {allOpen ? (
                  <ChevronsDownUp aria-hidden className="size-4" />
                ) : (
                  <ChevronsUpDown aria-hidden className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              {toggleAllLabel}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </header>
  )
}
