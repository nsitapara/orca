import type { TimelineRun, TimelineNext, WorktreeTimeline } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import { worktreePathSpellings } from '../fields/agent-activity'
import type { PilotStore } from '../store/store'
import { localDay } from '../usage/buckets'
import { mergeBackOf } from './merge-back'

export type TimelineDeps = {
  store: PilotStore
  definitions: () => readonly AutomationDefinition[]
  nextTickAt: (def: AutomationDefinition) => number | null
  now: () => number
}

// Runs in these states show under "Now"; every other run of today under "Earlier today".
const NOW_STATUSES: ReadonlySet<string> = new Set(['running', 'asking'])

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Soonest next tick first; manual automations (no next tick) last; then by name.
function byNextTick(a: TimelineNext, b: TimelineNext): number {
  if (a.nextTickAt === b.nextTickAt) {
    return a.automationName.localeCompare(b.automationName)
  }
  if (a.nextTickAt === null) {
    return 1
  }
  if (b.nextTickAt === null) {
    return -1
  }
  return a.nextTickAt - b.nextTickAt
}

// Read-only. `person` null (the default) means everyone's items; a person narrows every inbox item shown
// (the waiting list and the ones under each run) to theirs, so nobody else's questions leak.
export function buildWorktreeTimeline(
  deps: TimelineDeps,
  worktreePath: string,
  person: string | null
): WorktreeTimeline {
  const now = deps.now()
  const defs = new Map(deps.definitions().map((d) => [d.id, d] as const))
  const nameOf = (id: string): string => defs.get(id)?.name ?? id
  const next = deps.store.timeline
    .nextFor(worktreePath)
    .map((row) => {
      const def = defs.get(row.automationId)
      return {
        ...row,
        automationName: nameOf(row.automationId),
        nextTickAt: def ? deps.nextTickAt(def) : null
      }
    })
    .sort(byNextTick)
  const runs = deps.store.runs.forWorktree(worktreePathSpellings(worktreePath), startOfDay(now))
  const asked = deps.store.timeline
    .inboxForRuns(runs.map((r) => r.id))
    .filter((i) => person === null || i.person === person)
  const withDetail: TimelineRun[] = runs.map((run) => ({
    ...run,
    automationName: nameOf(run.automationId),
    steps: deps.store.runs.steps(run.id),
    inbox: asked.filter((i) => i.runId === run.id),
    ...(run.env?.kept ? { mergeBack: mergeBackOf(deps.store, run) } : {})
  }))
  const spent = deps.store.usage.costForWorktreeOn(
    worktreePathSpellings(worktreePath),
    localDay(now)
  )
  return {
    next,
    now: withDetail.filter((r) => NOW_STATUSES.has(r.status)),
    earlier: withDetail.filter((r) => !NOW_STATUSES.has(r.status)),
    waiting: deps.store.timeline.openInbox(worktreePath, person),
    spentTodayUsd: spent.costUsd,
    unpricedBuckets: spent.unpricedBuckets
  }
}
