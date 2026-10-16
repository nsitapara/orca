import { cn } from '@/lib/utils'
import type { StripChip, StripItem } from '../../shared/run-views/strip'
import { STATE_CLASS, STATE_LABEL, STATE_MARK, WHO_CLASS, WHO_LABEL } from './tokens'

function chipName(chip: StripChip): string {
  const state = chip.state && chip.state !== 'none' ? ` · ${STATE_LABEL[chip.state]}` : ''
  return `${WHO_LABEL[chip.who]} · ${chip.label}${state}`
}

function moreText(item: Extract<StripItem, { kind: 'more' }>): string {
  return item.unit ? `+${item.count} ${item.unit}` : `+${item.count}`
}

function Chip({
  chip,
  onChip
}: {
  chip: StripChip
  onChip: (chip: StripChip) => void
}): React.JSX.Element {
  const name = chipName(chip)
  const mark = chip.state ? STATE_MARK[chip.state] : ''
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      onClick={(e) => {
        e.stopPropagation()
        onChip(chip)
      }}
      className={cn(
        'inline-flex max-w-[min(14rem,100%)] items-center gap-1 rounded border px-1.5 text-[11px] leading-5 hover:brightness-110',
        WHO_CLASS[chip.who],
        chip.state ? STATE_CLASS[chip.state] : ''
      )}
    >
      {mark ? <span aria-hidden="true">{mark}</span> : null}
      <span className="truncate">{chip.label}</span>
      {chip.runIds.length > 1 ? (
        <span className="rounded bg-background/60 px-1 font-semibold">{chip.runIds.length}</span>
      ) : null}
    </button>
  )
}

// One line of chips (spec §2 Strip), wrapping rather than scrolling on a narrow page. Every chip is a button; `onChip`
// decides where it goes. A click never reaches the row under it.
export function RunStrip({
  items,
  label,
  onChip
}: {
  items: StripItem[]
  label: string
  onChip: (chip: StripChip) => void
}): React.JSX.Element {
  return (
    <ul aria-label={label} className="flex min-w-0 flex-wrap items-center gap-1">
      {items.map((item) =>
        item.kind === 'more' ? (
          <li
            key={item.key}
            className="rounded border border-border px-1.5 text-[11px] leading-5 text-muted-foreground"
          >
            {moreText(item)}
          </li>
        ) : (
          <li key={item.chip.key} className="min-w-0">
            <Chip chip={item.chip} onChip={onChip} />
          </li>
        )
      )}
    </ul>
  )
}
