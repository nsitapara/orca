import { money } from '../../shared/money'
import { relativeTime } from '../../shared/relative-time'
import type {
  ItemDecision,
  ItemFields,
  RunStatus,
  StepStatus,
  TickOutcome,
  TickRow,
  Verdict
} from '../../shared/api-types'

const VERDICT: Record<Verdict, string> = {
  started: 'Started',
  skipped: 'Skipped',
  notdue: 'Not due',
  out_of_scope: 'Not in scope',
  over_limit: 'Next tick',
  queued: 'Waiting for a slot',
  baselined: 'Baselined',
  asked: 'Asked first',
  held: 'Waiting'
}
// A dry run did none of these: they're what a tick would do.
const DRY_VERDICT: Partial<Record<Verdict, string>> = {
  started: 'Would start',
  asked: 'Would ask first',
  baselined: 'Would baseline'
}
const COUNT_ORDER: [Verdict, string][] = [
  ['started', 'started'],
  ['queued', 'waiting for a slot'],
  ['asked', 'asked first'],
  ['skipped', 'skipped'],
  ['notdue', 'not due'],
  ['over_limit', 'next tick'],
  ['baselined', 'baselined']
]
const DRY_COUNT: Partial<Record<Verdict, string>> = {
  started: 'would start',
  asked: 'would ask first',
  baselined: 'would baseline'
}

export { relativeTime }

// `dry`: a dry run's verdict, worded as what a tick would do.
export function verdictLabel(v: Verdict, dry = false): string {
  return (dry ? DRY_VERDICT[v] : undefined) ?? VERDICT[v]
}

// What Activity and a dry run list: an out-of-scope item was never checked, so it is left out (the CLI's dry run
// still prints it).
export function checkedItems<T extends { verdict: Verdict }>(items: readonly T[]): T[] {
  return items.filter((i) => i.verdict !== 'out_of_scope')
}

// The page an item is about (its Linear ticket, MR or pipeline); null when its source gives none.
export function itemUrl(fields: ItemFields): string | null {
  for (const name of ['ticket.url', 'mr.web_url', 'pipeline.web_url']) {
    const url = fields[name]
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      return url
    }
  }
  return null
}

function countsLine(counts: Partial<Record<Verdict, number>>, dry: boolean): string {
  const checked = Object.entries(counts)
    .filter(([v]) => v !== 'out_of_scope')
    .reduce((a, [, n]) => a + (n ?? 0), 0)
  const parts = COUNT_ORDER.filter(([v]) => counts[v]).map(
    ([v, label]) => `${counts[v]} ${(dry ? DRY_COUNT[v] : undefined) ?? label}`
  )
  return [`${checked} checked`, ...parts].join(' · ')
}

export function tickLine(t: TickRow): string {
  if (t.status === 'failed') {
    return `Failed: ${t.error ?? 'unknown error'}`
  }
  if (t.status === 'running') {
    return 'Running…'
  }
  return countsLine(t.counts, false)
}

// A dry run's summary, worded as what a tick would do.
export function dryRunLine(decisions: readonly ItemDecision[]): string {
  const counts: Partial<Record<Verdict, number>> = {}
  for (const d of decisions) {
    counts[d.verdict] = (counts[d.verdict] ?? 0) + 1
  }
  return countsLine(counts, true)
}

// The same wording as the CLI's dry-run / tick output. A dry run has no tick (tickId null).
export function outcomeLine(result: TickOutcome, id: string): string {
  if (result.status === 'busy') {
    return 'Tick already running'
  }
  if (result.status === 'unknown') {
    return `No automation ${id}`
  }
  const name = result.tickId === null ? 'Dry run' : `Tick ${result.tickId}`
  if (result.status === 'failed') {
    return `${name} · failed: ${result.error}`
  }
  return `${name} · ok`
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function lastTickText(t: TickRow, now: number): string {
  return `${relativeTime(t.startedAt, now)} · ${tickLine(t)}`
}

// A time in the automation's own timezone; falls back to local time for an unknown zone.
export function formatInZone(ms: number, timeZone: string): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short'
    })
  } catch {
    return new Date(ms).toLocaleString()
  }
}

// The run-status words, one map for the timeline, the panel and Activity.
const RUN_STATUS: Record<RunStatus, string> = {
  asking: 'Asking first',
  running: 'Running',
  needs_you: 'Needs you',
  done: 'Done',
  failed: 'Failed',
  timed_out: 'Timed out',
  cancelled: 'Cancelled'
}
const STEP_STATUS: Record<StepStatus, string> = {
  pending: 'Waiting',
  starting: 'Starting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  stopped: 'Stopped',
  timed_out: 'Timed out'
}

export function runStatusLabel(status: RunStatus): string {
  return RUN_STATUS[status]
}

export function stepStatusLabel(status: StepStatus): string {
  return STEP_STATUS[status]
}

// "1:10 PM": the time of day, in the viewer's own zone.
export function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// "1:10:07 PM": the time of day to the second, for a run's timeline.
export function clockSeconds(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  })
}

// Today's spend for the panel: the priced total, and "+ unpriced" when some usage had no price.
export function spentLabel(usd: number, unpricedBuckets: number): string {
  if (unpricedBuckets > 0) {
    return `${money(usd)} + unpriced`
  }
  return money(usd)
}
