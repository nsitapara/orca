import type {
  TelemetryCall,
  TelemetryCommand,
  TelemetryPayload,
  TelemetryUsage,
  TelemetryWindow
} from '../../../../shared/api-types-telemetry'

export type CommandSort = 'calls' | 'failed' | 'invalid' | 'p95'
export const UNREADABLE_ANSWER = "Pilot answered in a shape this page doesn't read"

// Each section's card, and its heading row.
export const SECTION_CLASS = 'flex min-w-0 flex-col gap-2 rounded-lg border border-border/50 py-3'
export const SECTION_HEAD_CLASS = 'flex flex-wrap items-center justify-between gap-2 px-4'

const WINDOW_DAYS: Record<TelemetryWindow, number> = { '7d': 7, '30d': 30, '90d': 90 }
// A window as words: "7 days".
export function windowText(since: TelemetryWindow): string {
  return `${WINDOW_DAYS[since]} days`
}

// A count as a table cell: - for none, so the counts that matter stand out.
export function countText(n: number | undefined): string {
  return n ? n.toLocaleString('en-US') : '-'
}

// A duration as a table cell: 11ms, 1.2s, 48s, 2m05s.
export function durationText(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  if (ms < 10_000) {
    return `${(ms / 1000).toFixed(1)}s`
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s`
  }
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

// A time of day, hh:mm in 24 hours.
export function clockText(at: number | string): string {
  return new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

// A day as "Oct 12". A bucket's bare date is that day here, not midnight UTC.
export function dayText(iso: string): string {
  const parts = DATE_ONLY.exec(iso)
  const at = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date(iso)
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function monthDay(at: Date): string {
  return `${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}

// hh:mm for a time on now's day, MM-DD before it; - when there is none.
export function lastText(iso: string, now: Date): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) {
    return '-'
  }
  if (at.toDateString() === now.toDateString()) {
    return clockText(iso)
  }
  return monthDay(at)
}

// A call's time: hh:mm on now's day, MM-DD hh:mm before it.
export function callTimeText(iso: string, now: Date): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime()) || at.toDateString() === now.toDateString()) {
    return lastText(iso, now)
  }
  return `${monthDay(at)} ${clockText(iso)}`
}

const CAUSE_TEXT: Record<string, string> = {
  invalid_flag: 'invalid flag',
  stack_start: 'stack start'
}
// A failed or invalid call's cause, one of pilotcli's fixed categories, as words.
export function causeText(call: Pick<TelemetryCall, 'cause' | 'http_status'>): string {
  if (!call.cause) {
    return '-'
  }
  if (call.cause === 'http') {
    return call.http_status ? `HTTP ${call.http_status}` : 'HTTP'
  }
  return CAUSE_TEXT[call.cause] ?? call.cause
}

const CALLER_TEXT: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  app: 'App',
  shell: 'Shell'
}

function whoOf(call: TelemetryCall): string {
  if (call.caller !== 'pilot') {
    return CALLER_TEXT[call.caller] ?? call.caller
  }
  if (call.agent && call.agent !== 'shell') {
    return `Pilot (${call.agent})`
  }
  return 'Pilot'
}

// Where: a job's short name (its number, or its id) and the step; terminal outside a run; nothing for Pilot itself.
function whereOf(call: TelemetryCall, names: ReadonlyMap<string, string>): string {
  if (call.caller === 'app') {
    return ''
  }
  if (!call.run && !call.automation) {
    return 'terminal'
  }
  const name = call.automation ? (names.get(call.automation) ?? call.automation) : 'run'
  const short = name.split(' · ')[0]
  return call.step ? `${short} ${call.step}` : short
}

// Who made a call and where: "Pilot (claude) · 05 context", "Claude · terminal", "App".
export function whoText(call: TelemetryCall, names: ReadonlyMap<string, string>): string {
  const where = whereOf(call, names)
  return where ? `${whoOf(call)} · ${where}` : whoOf(call)
}

const SORT_KEY: Record<CommandSort, (c: TelemetryCommand) => number> = {
  calls: (c) => c.calls,
  failed: (c) => c.failed,
  invalid: (c) => c.invalid,
  p95: (c) => c.p95_ms
}
// The commands, most first by the column picked, then by calls, then by name.
export function sortCommands(
  commands: readonly TelemetryCommand[],
  by: CommandSort
): TelemetryCommand[] {
  const key = SORT_KEY[by]
  return [...commands].sort(
    (a, b) => key(b) - key(a) || b.calls - a.calls || a.command.localeCompare(b.command)
  )
}

export function isCommandSort(value: string): value is CommandSort {
  return Object.hasOwn(SORT_KEY, value)
}

// The window's failed and invalid calls: pilotcli's totals, else the commands' sum (today's pilotcli has none).
export function totalsOf(usage: TelemetryUsage): { failed: number; invalid: number } {
  if (usage.totals) {
    return { failed: usage.totals.failed, invalid: usage.totals.invalid }
  }
  return usage.commands.reduce(
    (t, c) => ({ failed: t.failed + c.failed, invalid: t.invalid + c.invalid }),
    { failed: 0, invalid: 0 }
  )
}

// The class a failed or invalid count shows in: bold and coloured above 0, quiet at 0.
export function badClass(kind: 'failed' | 'invalid', n: number | undefined): string {
  if (!n) {
    return 'text-muted-foreground'
  }
  if (kind === 'failed') {
    return 'font-semibold text-destructive'
  }
  return 'font-semibold text-amber-600 dark:text-amber-300'
}

export type BarSegment = { kind: 'rest' | 'failed' | 'invalid'; y: number; height: number }
const MIN_MARK = 2

// One bucket's stacked bar in a chart `height` high, scaled to `peak`: ok or skip at the bottom, then failed, then
// invalid. A failed or invalid count never draws thinner than MIN_MARK, so one failure among a thousand calls shows.
// The rest is calls less failed and invalid, never a sum of outcomes: a call with no known outcome counts in calls.
export function barSegments(
  calls: number,
  failed: number,
  invalid: number,
  peak: number,
  height: number
): BarSegment[] {
  const parts: [BarSegment['kind'], number][] = [
    ['rest', Math.max(0, calls - failed - invalid)],
    ['failed', failed],
    ['invalid', invalid]
  ]
  const out: BarSegment[] = []
  let top = height
  for (const [kind, n] of parts) {
    if (n <= 0 || peak <= 0) {
      continue
    }
    const scaled = (n / peak) * height
    const h = kind === 'rest' ? scaled : Math.max(MIN_MARK, scaled)
    top -= h
    out.push({ kind, y: top, height: h })
  }
  return out
}

// A sparkline's points in a 100 × 20 box, the peak 1 from the top and 0 1 from the bottom.
export function sparkPoints(values: readonly number[]): string {
  const peak = Math.max(1, ...values)
  const step = values.length > 1 ? 100 / (values.length - 1) : 0
  return values
    .map((v, i) => `${Math.round(i * step)},${Math.round(19 - (v / peak) * 18)}`)
    .join(' ')
}

// Each call with a row key: its time, command and run (or caller), numbered when two calls share them.
export function keyedCalls(
  calls: readonly TelemetryCall[]
): { key: string; call: TelemetryCall }[] {
  const seen = new Map<string, number>()
  return calls.map((call) => {
    const base = `${call.ts}|${call.command}|${call.run ?? call.caller}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { key: n === 1 ? base : `${base}#${n}`, call }
  })
}

// Whether Pilot's answer is a telemetry payload: the usage and the failures, or why there are none.
export function isPayload(value: unknown): value is TelemetryPayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fetchedAt' in value &&
    ('usage' in value || 'error' in value)
  )
}

// pilotCLI's playground anchor for a command (internal/cli/markdown.go's anchor of "pilotcli <command>"): lower case,
// spaces as hyphens, only letters, digits, _ and - kept.
export function anchorOf(command: string): string {
  return `pilotcli ${command}`
    .toLowerCase()
    .replace(/ /g, '-')
    .replace(/[^a-z0-9_-]/g, '')
}
