import type { RunRow, StepRow } from '../../shared/api-types'
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

type Stale = { runs: RunRow[]; steps: StepRow[] }

// Both queries up front: if the store is unreadable, nothing is touched.
function findStale(store: PilotStore, cutoff: number): Stale {
  return {
    runs: store.runs.staleRunsWithoutSteps(cutoff),
    steps: store.runs.staleStartingSteps(cutoff)
  }
}

// A run that never got a step: the process stopped between creating it and starting its agent.
function closeStepless(store: PilotStore, run: RunRow, at: number): void {
  store.unmarkHandledForRun(run.automationId, run.id)
  store.runs.update(run.id, { status: 'failed', outcome: STALE_START_OUTCOME, finishedAt: at })
}

// A step is 'starting' with no terminal only while launchAgentTerminal is in flight, and a run has
// no step only for a moment before that. Two minutes on, the process that launched it has stopped
// (quit or crash): without this the run would hold an at_once slot and its once_per key forever.
// Runs at scheduler start and before every step poll. Never throws.
export function sweepStaleStarts(
  store: PilotStore,
  now: () => number,
  log: (message: string) => void,
  olderThanMs = STALE_START_MS
): void {
  const at = now()
  let stale: Stale
  try {
    stale = findStale(store, at - olderThanMs)
  } catch (error) {
    log(`[pilot] couldn't sweep stale starts: ${messageOf(error)}`)
    return
  }
  for (const run of stale.runs) {
    try {
      closeStepless(store, run, at)
      log(`[pilot] run ${run.id}: ${STALE_START_OUTCOME}`)
    } catch (error) {
      log(`[pilot] couldn't close stale run ${run.id}: ${messageOf(error)}`)
    }
  }
  for (const step of stale.steps) {
    try {
      if (closeStaleStart(store, step, at)) {
        log(`[pilot] run ${step.runId}: ${STALE_START_OUTCOME}`)
      }
    } catch (error) {
      log(`[pilot] couldn't close stale start ${step.runId}/${step.idx}: ${messageOf(error)}`)
    }
  }
}
