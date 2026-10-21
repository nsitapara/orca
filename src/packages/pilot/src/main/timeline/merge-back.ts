import type { RunRow } from '../../shared/api-types'
import type { MergeBack } from '../../shared/api-types-runs'
import type { PilotStore } from '../store/store'

// A run whose throwaway kept a branch: the kept_branch job's runs for it (item kept:<run>, newest first) and why its item
// waits in line now. Null when nothing was kept.
export function mergeBackOf(store: PilotStore, run: RunRow): MergeBack | null {
  if (!run.env?.kept) {
    return null
  }
  const key = `kept:${run.id}`
  const queued = store.capacity.queuedFor([key])[0]
  return {
    runs: store.activity.forItem(null, key),
    waiting: queued ? queued.holdDetail || 'Waiting for a slot' : null
  }
}
