import type { ActivityRun, RunRow } from '../../shared/api-types'
import type { PilotStore } from '../store/store'

// Each run with its steps and what it asked (open and answered cards), the cards in one query for all of them: what
// Activity, the list's live runs and an inbox card's run carry.
export function withDetail(store: PilotStore, runs: readonly RunRow[]): ActivityRun[] {
  const asked = store.timeline.inboxForRuns(runs.map((r) => r.id))
  return runs.map((run) => ({
    ...run,
    steps: store.runs.steps(run.id),
    inbox: asked.filter((i) => i.runId === run.id)
  }))
}
