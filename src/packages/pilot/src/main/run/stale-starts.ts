import type { RunRow, StepRow } from '../../shared/api-types'
import type { PilotStore } from '../store/store'

export const STALE_START_MS = 2 * 60_000
export const STALE_START_OUTCOME = "Couldn't start: the app stopped before the agent launched"
// A step stays 'pending' while its run's workspace is made (B8): a new worktree with its setup takes
// minutes. One still pending this long after its run started, and not being opened by this process, was
// left by an app that stopped while making the workspace.
export const STALE_PENDING_MS = 30 * 60_000
export const STALE_PENDING_OUTCOME =
  "Couldn't start: the app stopped while making the run's workspace"

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// An earlier step of this run ran (anything but skipped): the run did work, so it keeps its once_per
// key, and only this step fails. The run engine then ends the run (always steps still run).
function ranBefore(store: PilotStore, step: StepRow): boolean {
  return store.runs.steps(step.runId).some((s) => s.idx < step.idx && s.status !== 'skipped')
}

// Key first, then run, then step: each write is idempotent, so a failure part way is finished by the
// next sweep (the step stays 'starting' or 'pending' until its own write lands).
function closeStaleStart(store: PilotStore, step: StepRow, at: number, outcome: string): boolean {
  if (ranBefore(store, step)) {
    store.runs.updateStep(step.runId, step.idx, {
      status: 'failed',
      error: outcome,
      finishedAt: at
    })
    return false
  }
  const run = store.runs.get(step.runId)
  const failRun = run?.status === 'running'
  if (run) {
    store.unmarkHandledForRun(run.automationId, run.id)
  }
  if (failRun) {
    store.runs.update(step.runId, { status: 'failed', outcome, finishedAt: at })
  }
  store.runs.updateStep(step.runId, step.idx, { status: 'failed', error: outcome, finishedAt: at })
  return failRun
}

type Stale = { runs: RunRow[]; steps: StepRow[]; pending: StepRow[] }

// Every query up front: if the store is unreadable, nothing is touched.
function findStale(store: PilotStore, at: number, olderThanMs: number): Stale {
  return {
    runs: store.runs.staleRunsWithoutSteps(at - olderThanMs),
    steps: store.runs.staleStartingSteps(at - olderThanMs),
    pending: store.runs.stalePendingSteps(at - STALE_PENDING_MS)
  }
}

// A run that never got a step: the process stopped between creating it and starting its agent.
function closeStepless(store: PilotStore, run: RunRow, at: number): void {
  store.unmarkHandledForRun(run.automationId, run.id)
  store.runs.update(run.id, { status: 'failed', outcome: STALE_START_OUTCOME, finishedAt: at })
}

// A step is 'starting' with no terminal only while launchAgentTerminal is in flight, 'pending' only while
// its run's workspace is made, and a run has no step only for a moment before that. Past those bounds, the
// process that launched it has stopped (quit or crash): without this the run would hold its once_per key
// forever. `opening` names the runs this process is still opening (wireRunEngine's startRun): their
// pending steps are never closed. Runs at scheduler start and before every step poll. Never throws.
export function sweepStaleStarts(
  store: PilotStore,
  now: () => number,
  log: (message: string) => void,
  olderThanMs = STALE_START_MS,
  opening: (runId: string) => boolean = () => false
): void {
  const at = now()
  let stale: Stale
  try {
    stale = findStale(store, at, olderThanMs)
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
  const closing: [StepRow, string][] = [
    ...stale.steps.map((step): [StepRow, string] => [step, STALE_START_OUTCOME]),
    ...stale.pending
      .filter((step) => !opening(step.runId))
      .map((step): [StepRow, string] => [step, STALE_PENDING_OUTCOME])
  ]
  for (const [step, outcome] of closing) {
    try {
      if (closeStaleStart(store, step, at, outcome)) {
        log(`[pilot] run ${step.runId}: ${outcome}`)
      }
    } catch (error) {
      log(`[pilot] couldn't close stale start ${step.runId}/${step.idx}: ${messageOf(error)}`)
    }
  }
}
