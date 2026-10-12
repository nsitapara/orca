import { money } from '../../shared/money'
import type { RunStatus, StepStatus, TickOutcome, TickRow, Verdict } from '../../shared/api-types'

const VERDICT: Record<Verdict, string> = {
  started: 'Started',
  skipped: 'Skipped',
  notdue: 'Not due',
  out_of_scope: 'Not in scope',
  over_limit: 'Next tick',
  baselined: 'Baselined',
  asked: 'Asked first'
}
const COUNT_ORDER: [Verdict, string][] = [
  ['started', 'started'],
  ['asked', 'asked first'],
  ['skipped', 'skipped'],
  ['notdue', 'not due'],
  ['over_limit', 'next tick'],
  ['baselined', 'baselined']
]

export function verdictLabel(v: Verdict): string {
  return VERDICT[v]
}

export function relativeTime(ms: number, now: number): string {
  const delta = now - ms
  const abs = Math.abs(delta)
  let text = `${Math.round(abs / 3_600_000)} h`
  if (abs < 60_000) {
    return 'just now'
  }
  if (abs < 3_600_000) {
    text = `${Math.round(abs / 60_000)} min`
  }
  if (delta < 0) {
    return `in ${text}`
  }
  return `${text} ago`
}

export function tickLine(t: TickRow): string {
  if (t.status === 'failed') {
    return `Failed: ${t.error ?? 'unknown error'}`
  }
  if (t.status === 'running') {
    return 'Running…'
  }
  const checked = Object.entries(t.counts)
    .filter(([v]) => v !== 'out_of_scope')
    .reduce((a, [, n]) => a + (n ?? 0), 0)
  const parts = COUNT_ORDER.filter(([v]) => t.counts[v]).map(
    ([v, label]) => `${t.counts[v]} ${label}`
  )
  return [`${checked} checked`, ...parts].join(' · ')
}

// The same wording as the CLI's dry-run / tick output.
export function outcomeLine(result: TickOutcome, id: string): string {
  if (result.status === 'busy') {
    return 'Tick already running'
  }
  if (result.status === 'unknown') {
    return `No automation ${id}`
  }
  if (result.status === 'failed') {
    return `Tick ${result.tickId} · failed: ${result.error}`
  }
  return `Tick ${result.tickId} · ok`
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function lastTickText(t: TickRow, now: number): string {
  const kind = t.dryRun ? 'dry run · ' : ''
  return `${relativeTime(t.startedAt, now)} · ${kind}${tickLine(t)}`
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

// Today's spend for the panel: the priced total, and "+ unpriced" when some usage had no price.
export function spentLabel(usd: number, unpricedBuckets: number): string {
  if (unpricedBuckets > 0) {
    return `${money(usd)} + unpriced`
  }
  return money(usd)
}
