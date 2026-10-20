import type { ItemFields } from '../../shared/api-types'
import type { PilotStore } from '../store/store'

const MAX_PARENTS = 5

// The fields a run started with: its tick's snapshot of the item, or for an answer run (no tick) its
// parent's. Empty once the tick aged out (30 days) or for an imported run.
export function fieldsForRun(store: PilotStore, runId: string): ItemFields {
  let id: string | null = runId
  for (let depth = 0; id !== null && depth <= MAX_PARENTS; depth += 1) {
    const run = store.runs.get(id)
    if (!run) {
      return {}
    }
    if (run.tickId !== null) {
      const tickId = run.tickId
      return store.tickItems(tickId).find((i) => i.itemKey === run.itemKey)?.fields ?? {}
    }
    id = run.parentRunId
  }
  return {}
}

// The newest real tick's snapshot of the item, for a card added outside a run.
export function latestFieldsFor(
  store: PilotStore,
  automationId: string,
  itemKey: string
): ItemFields {
  const tick = store.lastTick(automationId)
  if (!tick) {
    return {}
  }
  return store.tickItems(tick.id).find((i) => i.itemKey === itemKey)?.fields ?? {}
}

// The branch the run's item is about: an MR's, a worktree's, or a Linear ticket's (whose worktree the run itself makes).
export function branchOfRun(store: PilotStore, runId: string): string | null {
  const fields = fieldsForRun(store, runId)
  const branch = fields['mr.branch'] ?? fields['worktree.branch'] ?? fields['ticket.branch']
  return typeof branch === 'string' && branch !== '' ? branch : null
}
