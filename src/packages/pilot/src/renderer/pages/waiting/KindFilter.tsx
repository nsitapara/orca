import { ChevronDown } from 'lucide-react'
import type { InboxType } from '../../../shared/api-types'
import { cn } from '@/lib/utils'
import { INBOX_KINDS } from './inbox-tabs'
import { useKindsOpen } from './use-list-open'

export type KindFilterProps = {
  kinds: readonly InboxType[]
  counts: Partial<Record<InboxType, number>>
  // The tab's cards the picked kinds leave shown, and all of them.
  shown: number
  total: number
  onKinds: (kinds: readonly InboxType[]) => void
}

// Kinds with cards, and any picked one at zero, so a pressed kind never disappears.
function kindOptions({ kinds, counts, onKinds }: KindFilterProps) {
  return INBOX_KINDS.filter(({ type }) => (counts[type] ?? 0) > 0 || kinds.includes(type)).map(
    ({ type, label }) => {
      const on = kinds.includes(type)
      return {
        type,
        label,
        count: counts[type] ?? 0,
        on,
        toggle: () => onKinds(on ? kinds.filter((kind) => kind !== type) : [...kinds, type])
      }
    }
  )
}

function ClearKinds({ kinds, shown, total, onKinds }: KindFilterProps): React.JSX.Element | null {
  if (kinds.length === 0) {
    return null
  }
  return (
    <button
      type="button"
      onClick={() => onKinds([])}
      className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
    >
      Clear · {shown} of {total} shown
    </button>
  )
}

// The kind chips in the row under the header, while the list is not beside the cards.
export function KindChips(props: KindFilterProps): React.JSX.Element {
  return (
    <div role="group" aria-label="Kind" className="flex flex-wrap items-center gap-1.5">
      {kindOptions(props).map(({ type, label, count, on, toggle }) => (
        <button
          key={type}
          type="button"
          aria-pressed={on}
          onClick={toggle}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold',
            on
              ? 'border-transparent bg-[var(--ib-accent-soft)] text-[var(--ib-accent)]'
              : 'border-border bg-card text-muted-foreground hover:text-foreground'
          )}
        >
          {label} · {count}
        </button>
      ))}
      <ClearKinds {...props} />
    </div>
  )
}

// The same kinds at the top of the list; folding it keeps Clear in view while a kind is picked.
export function KindSection(props: KindFilterProps): React.JSX.Element | null {
  const [open, toggleOpen] = useKindsOpen()
  const options = kindOptions(props)
  if (options.length === 0) {
    return null
  }
  return (
    <div role="group" aria-label="Kind" className="flex shrink-0 flex-col border-b border-border">
      <div className="flex h-8 items-center gap-2 pr-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={toggleOpen}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 text-left font-mono text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'size-3.5 shrink-0 transition-transform motion-reduce:transition-none',
              !open && '-rotate-90'
            )}
          />
          Kind
        </button>
        <ClearKinds {...props} />
      </div>
      {open ? (
        <ul className="flex flex-col gap-0.5 px-1.5 pb-1.5">
          {options.map(({ type, label, count, on, toggle }) => (
            <li key={type}>
              <button
                type="button"
                aria-pressed={on}
                aria-label={`${label} · ${count}`}
                onClick={toggle}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[13px]',
                  on
                    ? 'bg-[var(--ib-accent-soft)] text-[var(--ib-accent)]'
                    : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
              >
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <span className="shrink-0 rounded-full bg-muted px-1.5 font-mono text-[11px]">
                  {count}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
