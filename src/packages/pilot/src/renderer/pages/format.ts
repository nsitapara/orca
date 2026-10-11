import type { TickOutcome, TickRow, Verdict } from '../../shared/api-types'

const VERDICT: Record<Verdict, string> = {
  started: 'Started',
  skipped: 'Skipped',
  notdue: 'Not due',
  out_of_scope: 'Not in scope',
  over_limit: 'Next tick',
  baselined: 'Baselined'
}
const COUNT_ORDER: [Verdict, string][] = [
  ['started', 'started'],
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
