import { useState } from 'react'
import {
  isTelemetryCommandName,
  type TelemetryCommand,
  type TelemetryUsage,
  type TelemetryWindow
} from '../../../../shared/api-types-telemetry'
import { SourceLink } from '../../../run-views/SourceLink'
import { ResizableHeaderCell } from '../../ResizableHeaderCell'
import { useColumnWidths, type ColumnSpec } from '../../use-column-widths'
import { Select } from '../../waiting/InboxHeader'
import { Sparkline } from './telemetry-charts'
import {
  badClass,
  commandText,
  countText,
  durationText,
  isCommandSort,
  lastText,
  SECTION_CLASS,
  SECTION_HEAD_CLASS,
  sortCommands,
  windowText,
  type CommandSort
} from './telemetry-view'

// Widths are remembered per viewer, by column id.
export const COMMANDS_WIDTHS_KEY = 'pilot.playground.telemetry.commands.widths'

// A column of numbers, right-aligned as By automation's are.
function count(id: string, label: string): ColumnSpec {
  return { id, label, defaultWidth: 68, minWidth: 48, align: 'right' }
}

// The commands table's columns; CommandRow's cells follow this order. The series column's label is the window.
function columnsFor(since: TelemetryWindow): ColumnSpec[] {
  return [
    { id: 'command', label: 'Command', defaultWidth: 220, minWidth: 120 },
    count('calls', 'Calls'),
    { id: 'series', label: windowText(since), defaultWidth: 96, minWidth: 56 },
    count('claude', 'Claude'),
    count('codex', 'Codex'),
    count('pilot', 'Pilot'),
    count('app', 'App'),
    count('shell', 'Shell'),
    count('failed', 'Failed'),
    count('invalid', 'Invalid'),
    count('p50', 'p50'),
    count('p95', 'p95'),
    { id: 'last', label: 'Last', defaultWidth: 68, minWidth: 56, align: 'right' }
  ]
}

const SORTS: { id: CommandSort; label: string }[] = [
  { id: 'calls', label: 'calls' },
  { id: 'failed', label: 'failed' },
  { id: 'invalid', label: 'invalid' },
  { id: 'p95', label: 'p95' }
]

const CELL = 'truncate px-3 py-1.5'
const NUMBER = 'truncate px-3 py-1.5 text-right font-mono tabular-nums'

function nameClass(c: TelemetryCommand, picked: boolean): string {
  const tone = c.removed ? 'text-muted-foreground' : ''
  const on = picked ? 'underline underline-offset-2' : ''
  return `font-mono hover:underline ${tone} ${on}`
}

// A name pilot.telemetry.get accepts is a button that picks it; any other (pilotcli's row with no command, a one-word
// name from before modules had verbs) is plain text, so a pick can never ask for a refused name.
function CommandName({
  c,
  picked,
  onPick
}: {
  c: TelemetryCommand
  picked: boolean
  onPick: (command: string) => void
}): React.JSX.Element {
  if (!isTelemetryCommandName(c.command)) {
    const tone = c.command ? '' : 'text-muted-foreground'
    return <span className={`font-mono ${tone}`}>{commandText(c.command)}</span>
  }
  return (
    <button
      type="button"
      aria-pressed={picked}
      className={nameClass(c, picked)}
      onClick={() => onPick(c.command)}
    >
      {c.command}
    </button>
  )
}

function CommandRow({
  c,
  now,
  picked,
  onPick
}: {
  c: TelemetryCommand
  now: Date
  picked: boolean
  onPick: (command: string) => void
}): React.JSX.Element {
  return (
    <tr className={picked ? 'border-t border-border/50 bg-muted/40' : 'border-t border-border/50'}>
      <td className={CELL} title={commandText(c.command)}>
        <CommandName c={c} picked={picked} onPick={onPick} />
        {c.removed ? (
          <span className="ml-2 rounded border border-border px-1.5 text-[11px] text-muted-foreground">
            removed
          </span>
        ) : null}
      </td>
      <td className={NUMBER}>{countText(c.calls)}</td>
      <td className="px-3 py-1.5">{c.series ? <Sparkline values={c.series} /> : null}</td>
      <td className={`${NUMBER} text-muted-foreground`}>{countText(c.callers.claude)}</td>
      <td className={`${NUMBER} text-muted-foreground`}>{countText(c.callers.codex)}</td>
      <td className={`${NUMBER} text-muted-foreground`}>{countText(c.callers.pilot)}</td>
      <td className={`${NUMBER} text-muted-foreground`}>{countText(c.callers.app)}</td>
      <td className={`${NUMBER} text-muted-foreground`}>{countText(c.callers.shell)}</td>
      <td className={`${NUMBER} ${badClass('failed', c.failed)}`}>{countText(c.failed)}</td>
      <td className={`${NUMBER} ${badClass('invalid', c.invalid)}`}>{countText(c.invalid)}</td>
      <td className={NUMBER}>{durationText(c.p50_ms)}</td>
      <td className={NUMBER} title={c.max_ms ? `slowest ${durationText(c.max_ms)}` : undefined}>
        {durationText(c.p95_ms)}
      </td>
      <td className={`${NUMBER} text-muted-foreground`}>{lastText(c.last, now)}</td>
    </tr>
  )
}

// The commands not called in the window, on one line.
function NeverCalled({
  unused,
  since
}: {
  unused: string[]
  since: TelemetryWindow
}): React.JSX.Element | null {
  if (unused.length === 0) {
    return null
  }
  return (
    <div className="border-t border-border/50 px-4 pt-2 text-xs text-muted-foreground">
      <p>{`Never called in ${windowText(since)}:`}</p>
      <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
        {unused.map((command) => (
          <li key={command} className="inline-flex items-center gap-1.5">
            <span className="font-mono text-foreground">{command}</span>
            <SourceLink part={{ skill: null, runs: `pilotcli ${command}` }} />
          </li>
        ))}
      </ul>
    </div>
  )
}

// Each command's calls in the window, who made them, how they ended and how long they took. Clicking a command
// shows its failed and invalid calls below; clicking it again shows every command's.
export function TelemetryCommands({
  usage,
  since,
  picked,
  onPick
}: {
  usage: TelemetryUsage
  since: TelemetryWindow
  picked: string | null
  onPick: (command: string) => void
}): React.JSX.Element {
  const [sort, setSort] = useState<CommandSort>('calls')
  const columns = useColumnWidths(COMMANDS_WIDTHS_KEY)
  const specs = columnsFor(since)
  const total = specs.reduce((sum, col) => sum + columns.widthOf(col), 0)
  const now = new Date(usage.to)
  return (
    <section className={SECTION_CLASS}>
      <div className={SECTION_HEAD_CLASS}>
        <h3 className="text-sm font-semibold">Commands</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Select
            label="Sort commands"
            prefix="Sorted by"
            value={sort}
            onChange={(v) => isCommandSort(v) && setSort(v)}
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
          <span>Click a command for its failed and invalid calls</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table
          aria-label="Commands"
          className="text-[13px]"
          style={{ tableLayout: 'fixed', width: total }}
        >
          <colgroup>
            {specs.map((col) => (
              <col key={col.id} style={{ width: columns.widthOf(col) }} />
            ))}
          </colgroup>
          <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              {specs.map((col) => (
                <ResizableHeaderCell key={col.id} col={col} columns={columns} />
              ))}
            </tr>
          </thead>
          <tbody>
            {sortCommands(usage.commands, sort).map((c) => (
              <CommandRow
                key={c.command}
                c={c}
                now={now}
                picked={picked === c.command}
                onPick={onPick}
              />
            ))}
          </tbody>
        </table>
      </div>
      <NeverCalled unused={usage.unused} since={since} />
    </section>
  )
}
