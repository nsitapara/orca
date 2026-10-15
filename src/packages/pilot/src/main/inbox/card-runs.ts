import type { ActivityRun } from '../../shared/api-types'
import type { PilotStore } from '../store/store'
import { withDetail } from '../timeline/run-detail'

// The run each listed card came from, with its steps and what it asked: the card's "From run" strip (spec §3). A run
// that is gone is left out, and its card shows no strip.
export function cardRuns(
  store: PilotStore,
  items: readonly { runId: string | null }[]
): Record<string, ActivityRun> {
  const ids = [...new Set(items.flatMap((i) => (i.runId ? [i.runId] : [])))]
  const rows = ids.flatMap((id) => {
    const run = store.runs.get(id)
    return run ? [run] : []
  })
  return Object.fromEntries(withDetail(store, rows).map((r) => [r.id, r]))
}
