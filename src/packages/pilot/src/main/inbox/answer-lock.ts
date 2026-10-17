import type { InboxItemRow, QueueRow, RunStatus } from '../../shared/api-types'
import type { PilotStore } from '../store/store'

export const ANSWER_LOCKED = "This answer is already being carried out; it can't be changed now"

// An answer run that may still be applying its answer. A finished one (done, needs_you, failed, …) has
// had its onRunEnd (answer-run-end.ts), so its answer is no longer in flight.
const LIVE_RUN: ReadonlySet<RunStatus> = new Set(['asking', 'running'])

// Is `runId` the live answer run this card's answer was dispatched to? Only that run may ask for clarification
// and leave the card open (the answers prompt's `pilot inbox reply`).
export function ownsLiveAnswer(store: PilotStore, item: InboxItemRow, runId: string): boolean {
  return store.queue.forInboxItem(item.id).some((row) => {
    if (row.state !== 'dispatched' || row.dispatchedRunId !== runId) {
      return false
    }
    const run = store.runs.get(runId)
    return Boolean(run && LIVE_RUN.has(run.status))
  })
}

// THE rule for when an answer may no longer be taken back or replaced (Undo, a new answer, a
// changed re-add): it may be being carried out. That is a ready row past its settle time (a pass picked it
// up, and a script action may be running), or a dispatched row whose answer run is still live. A row still
// settling, held, or failed stays changeable. `liveRuns` are the ids of the runs still asking or running.
export function lockedBy(
  rows: readonly QueueRow[],
  liveRuns: ReadonlySet<string>,
  now: number,
  callerRunId: string | null = null
): boolean {
  return rows.some((r) => {
    if (r.state === 'ready') {
      return r.readyAt <= now
    }
    const run = r.dispatchedRunId
    return r.state === 'dispatched' && run !== null && run !== callerRunId && liveRuns.has(run)
  })
}

export function answerLocked(
  store: PilotStore,
  item: InboxItemRow,
  now: number,
  callerRunId: string | null = null
): boolean {
  if (item.status !== 'answered') {
    return false
  }
  const rows = store.queue.forInboxItem(item.id)
  const runs = rows.flatMap((r) => (r.dispatchedRunId ? [r.dispatchedRunId] : []))
  return lockedBy(rows, store.runs.liveAmong(runs), now, callerRunId)
}
