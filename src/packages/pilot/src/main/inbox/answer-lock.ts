import type { InboxItemRow, RunStatus } from '../../shared/api-types'
import type { PilotStore } from '../store/store'

export const ANSWER_LOCKED = "This answer is already being carried out; it can't be changed now"

// An answer run that may still be applying its answer. A finished one (done, needs_you, failed, …) has
// had its onRunEnd (answer-run-end.ts), so its answer is no longer in flight.
const LIVE_RUN: ReadonlySet<RunStatus> = new Set(['asking', 'running'])

// The card's answer is being applied by an answer run: the card is 'answered' and a dispatched queue row
// names a run still running. A dispatched row outlives its run, and one with no run (sent before Pilot)
// never counts. The caller's own run doesn't count either: an answer run re-drafting its card clears the
// answer it is applying.
function dispatchedAndLive(
  store: PilotStore,
  item: InboxItemRow,
  callerRunId: string | null
): boolean {
  return store.queue.forInboxItem(item.id).some((row) => {
    if (row.state !== 'dispatched' || row.dispatchedRunId === null) {
      return false
    }
    if (row.dispatchedRunId === callerRunId) {
      return false
    }
    const run = store.runs.get(row.dispatchedRunId)
    return Boolean(run && LIVE_RUN.has(run.status))
  })
}

// THE rule for when an answer may no longer be taken back or replaced (Undo, a new answer, set-details, a
// changed re-add): it may be being carried out. That is a ready row past its settle time (a pass picked it
// up, and a script action may be running), or a dispatched row whose answer run is still live. A row still
// settling, held, or failed stays changeable.
export function answerLocked(
  store: PilotStore,
  item: InboxItemRow,
  now: number,
  callerRunId: string | null = null
): boolean {
  if (item.status !== 'answered') {
    return false
  }
  if (dispatchedAndLive(store, item, callerRunId)) {
    return true
  }
  return store.queue.forInboxItem(item.id).some((r) => r.state === 'ready' && r.readyAt <= now)
}
