import type { StepRow } from '../../shared/api-types'
import type { PilotStore } from '../store/store'

export const STALE_START_MS = 2 * 60_000
export const STALE_START_OUTCOME = "Couldn't start: the app stopped before the agent launched"

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Key first, then run, then step: each write is idempotent, so a failure part way is finished by the
// next sweep (the step stays 'starting' until its own write lands).
function closeStaleStart(store: PilotStore, step: StepRow, at: number): boolean {
  const run = store.runs.get(step.runId)
  const failRun = run?.status === 'running'
  if (run) {
    store.unmarkHandledForRun(run.automationId, run.id)
  }
  if (failRun) {
    store.runs.update(step.runId, {
      status: 'failed',
      outcome: STALE_START_OUTCOME,
      finishedAt: at
    })
  }
  store.runs.updateStep(step.runId, step.idx, {
    status: 'failed',
    error: STALE_START_OUTCOME,
    finishedAt: at
  })
  return failRun
}

// A step is 'starting' with no terminal only while launchAgentTerminal is in flight. Two minutes on,
// the process that launched it has stopped (quit or crash): without this the run would hold an
// at_once slot and its once_per key forever. Runs at scheduler start and before every step poll.
// Never throws.
export function sweepStaleStarts(
  store: PilotStore,
  now: () => number,
  log: (message: string) => void,
  olderThanMs = STALE_START_MS
): void {
  const at = now()
  let stale: StepRow[]
  try {
    stale = store.runs.staleStartingSteps(at - olderThanMs)
  } catch (error) {
    log(`[pilot] couldn't sweep stale starts: ${messageOf(error)}`)
    return
  }
  for (const step of stale) {
    try {
      if (closeStaleStart(store, step, at)) {
        log(`[pilot] run ${step.runId}: ${STALE_START_OUTCOME}`)
      }
    } catch (error) {
      log(`[pilot] couldn't close stale start ${step.runId}/${step.idx}: ${messageOf(error)}`)
    }
  }
}
