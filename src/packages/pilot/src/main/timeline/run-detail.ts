import type { ActivityRun, ListedRun, RunRow, TickItemRow } from '../../shared/api-types'
import type { PilotStore } from '../store/store'
import { mergeBackOf } from './merge-back'

// Each run with its steps, what it asked (open and answered cards, in one query for all of them) and, when its throwaway
// kept a branch, how its merge back stands: what Activity, the list's live runs and an inbox card's run carry.
export function withDetail(store: PilotStore, runs: readonly RunRow[]): ActivityRun[] {
  const asked = store.timeline.inboxForRuns(runs.map((r) => r.id))
  return runs.map((run) => ({
    ...run,
    steps: store.runs.steps(run.id),
    inbox: asked.filter((i) => i.runId === run.id),
    ...(run.env?.kept ? { mergeBack: mergeBackOf(store, run) } : {})
  }))
}

// The item a run came from, as its tick recorded it; null when it had no tick or the tick was pruned (30 days).
export function tickItemOf(store: PilotStore, run: RunRow): TickItemRow | null {
  if (run.tickId === null) {
    return null
  }
  return store.tickItems(run.tickId).find((i) => i.runId === run.id) ?? null
}

// Runs as Activity lists them: their detail, and their tick item's fields for the item link ({} when it had none).
export function listedRuns(store: PilotStore, runs: readonly RunRow[]): ListedRun[] {
  return withDetail(store, runs).map((run) => ({
    ...run,
    fields: tickItemOf(store, run)?.fields ?? {}
  }))
}
