import { cn } from '@/lib/utils'
import type { StripChip, StripItem } from '../../shared/run-views/strip'
import type { PilotHostRef } from '../hosts/pilot-host'
import { useMachineChipsShown } from '../hosts/pilot-hosts-feed'
import {
  HIGHLIGHT_CLASS,
  STATE_CLASS,
  STATE_LABEL,
  STATE_MARK,
  WHO_CLASS,
  WHO_LABEL
} from './tokens'

// A run's strip name; with more than one machine listed it names the machine, as two machines' runs can share an id.
export function useRunStripLabel(runId: string, host: PilotHostRef): string {
  const named = useMachineChipsShown()
  return named ? `Run ${runId} on ${host.machineName}` : `Run ${runId}`
}

function chipText(chip: StripChip): string {
  return chip.n === null ? chip.label : `${chip.n} ${chip.label}`
}

function chipName(chip: StripChip): string {
  const state = chip.state && chip.state !== 'none' ? ` · ${STATE_LABEL[chip.state]}` : ''
  return `${WHO_LABEL[chip.who]} · ${chipText(chip)}${state}`
}

// A chip's mark: ✓, ●, ✗ and the like. Waiting on Nish shows as the amber ring alone, never a "?".
function markOf(chip: StripChip): string {
  if (!chip.state || chip.state === 'asking') {
    return ''
  }
  return STATE_MARK[chip.state]
}

function moreText(item: Extract<StripItem, { kind: 'more' }>): string {
  return item.unit ? `+${item.count} ${item.unit}` : `+${item.count}`
}

function Chip({
  chip,
  highlighted,
  onChip
}: {
  chip: StripChip
  highlighted: boolean
  onChip: (chip: StripChip) => void
}): React.JSX.Element {
  const name = chipName(chip)
  const mark = markOf(chip)
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      data-highlighted={highlighted ? '' : undefined}
      onClick={(e) => {
        e.stopPropagation()
        onChip(chip)
      }}
      className={cn(
        'inline-flex max-w-[min(14rem,100%)] items-center gap-1 rounded border px-1.5 text-[11px] leading-5 hover:brightness-110',
        WHO_CLASS[chip.who],
        chip.state ? STATE_CLASS[chip.state] : '',
        highlighted ? HIGHLIGHT_CLASS : ''
      )}
    >
      {chip.n !== null ? (
        <span className="rounded-full bg-background/70 px-1 font-semibold tabular-nums text-foreground">
          {chip.n}
        </span>
      ) : null}
      <span className="truncate">{chip.label}</span>
      {mark ? <span aria-hidden="true">{mark}</span> : null}
      {chip.runIds.length > 1 ? (
        <span className="rounded bg-background/60 px-1 font-semibold">{chip.runIds.length}</span>
      ) : null}
    </button>
  )
}

// One line of chips (spec §2 Strip), wrapping rather than scrolling on a narrow page. Every chip is a button; `onChip`
// decides where it goes. A click never reaches the row under it. `highlight` lights one chip amber: on a card, the step
// its question came from.
export function RunStrip({
  items,
  label,
  highlight = null,
  onChip
}: {
  items: StripItem[]
  label: string
  highlight?: string | null
  onChip: (chip: StripChip) => void
}): React.JSX.Element {
  return (
    <ul aria-label={label} className="flex min-w-0 flex-wrap items-center gap-1">
      {items.map((item) => {
        if (item.kind === 'more') {
          return (
            <li
              key={item.key}
              className="rounded border border-border px-1.5 text-[11px] leading-5 text-muted-foreground"
            >
              {moreText(item)}
            </li>
          )
        }
        if (item.kind === 'note') {
          return (
            <li key={item.key} className="px-1 text-[11px] leading-5 text-muted-foreground">
              {item.text}
            </li>
          )
        }
        return (
          <li key={item.chip.key} className="min-w-0">
            <Chip
              chip={item.chip}
              highlighted={highlight !== null && item.chip.key === highlight}
              onChip={onChip}
            />
          </li>
        )
      })}
    </ul>
  )
}
