import type {
  ActivityPayload,
  ActivityRun,
  ActivityTick,
  ItemFields,
  ListedRun
} from '../../shared/api-types'
import type { PilotHostRef } from '../hosts/pilot-host'

// The window tags runs and ticks with their machine; an untagged one is this machine's.
type OnHost<T> = T & { host?: PilotHostRef }
export type GroupedRun = OnHost<ListedRun>
export type GroupedTick = OnHost<Omit<ActivityTick, 'runs'> & { runs: OnHost<ActivityRun>[] }>
type RunKey = (run: { id: string; host?: PilotHostRef }) => string

export type DayEntry =
  | { kind: 'tick'; at: number; tick: GroupedTick }
  | { kind: 'run'; at: number; run: GroupedRun }
export type ActivityGroups = {
  running: GroupedRun[]
  waiting: GroupedRun[]
  days: { key: string; label: string; entries: DayEntry[] }[]
}

const byId: RunKey = (run) => run.id

const DAY_MS = 24 * 60 * 60_000

// A live run waits on Nish when it asked first, finished asking, or has a card open.
function waitsOnYou(run: ListedRun): boolean {
  return run.status !== 'running' || run.inbox.some((i) => i.status === 'open')
}

export function dayLabel(at: number, now: number): string {
  const day = new Date(at).toDateString()
  if (day === new Date(now).toDateString()) {
    return 'Earlier today'
  }
  if (day === new Date(now - DAY_MS).toDateString()) {
    return 'Yesterday'
  }
  return new Date(at).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric'
  })
}

// Midnight six days ago: the Activity page reads a week.
export function weekStart(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - 6)
  return d.getTime()
}

// Activity's sections (spec §3): Running now, Waiting on you, then each day newest first. A live run sits only in its
// section above, never again under its tick line. `keyOf` names one run; across machines it must name the machine too.
export function groupActivity(
  p: ActivityPayload,
  now: number,
  keyOf: RunKey = byId
): ActivityGroups {
  const liveKeys = new Set(p.live.map(keyOf))
  const entries: DayEntry[] = [
    ...p.ticks.map((tick) => ({
      kind: 'tick' as const,
      at: tick.startedAt,
      tick: { ...tick, runs: tick.runs.filter((r) => !liveKeys.has(keyOf(r))) }
    })),
    ...p.loose
      .filter((r) => !liveKeys.has(keyOf(r)))
      .map((run) => ({ kind: 'run' as const, at: run.startedAt, run }))
  ].sort((a, b) => b.at - a.at)
  const days: ActivityGroups['days'] = []
  for (const e of entries) {
    const key = new Date(e.at).toDateString()
    const day = days.find((d) => d.key === key)
    if (day) {
      day.entries.push(e)
    } else {
      days.push({ key, label: dayLabel(e.at, now), entries: [e] })
    }
  }
  return { running: p.live.filter((r) => !waitsOnYou(r)), waiting: p.live.filter(waitsOnYou), days }
}

// The run picker's runs on How it runs: live ones and recent ones, once each, newest first.
export function runCandidates(
  p: ActivityPayload,
  max = 10,
  keyOf: RunKey = byId
): OnHost<ActivityRun>[] {
  const all: OnHost<ActivityRun>[] = [...p.live, ...p.ticks.flatMap((t) => t.runs), ...p.loose]
  const seen = new Set<string>()
  const unique = all.filter((r) => {
    const key = keyOf(r)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
  return unique.sort((a, b) => b.startedAt - a.startedAt).slice(0, max)
}

// The run How it runs shows first (spec §2 Rail): the running one, else the newest. Its key, by `keyOf`.
export function defaultRun(
  runs: readonly OnHost<ActivityRun>[],
  keyOf: RunKey = byId
): string | null {
  const run = runs.find((r) => r.status === 'running') ?? runs[0]
  return run ? keyOf(run) : null
}

// "05" from "05 · Fix failed CI": a row's job tag. A name with no code is its own tag.
export function jobCode(name: string): string {
  return name.split(' · ')[0] ?? name
}

// A ticked run's item fields, from its tick's item: its item link.
export function fieldsOf(tick: ActivityTick, runId: string): ItemFields {
  return tick.items.find((i) => i.runId === runId)?.fields ?? {}
}
