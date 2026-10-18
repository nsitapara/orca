import type { RunRow, StepRow } from '../../shared/api-types'
import type { FailureCounted } from '../capacity/give-up'
import type { PilotStore } from '../store/store'
import { repend } from '../handover/repend'

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

export type SweepOptions = {
  olderThanMs?: number
  // The runs this process is still opening (wireRunEngine's startRun): their pending steps are never closed.
  opening?(runId: string): boolean
  // A swept start counted a failure on its key (the give-up card).
  failureCounted?: FailureCounted
  // An ask-first job's swept start frees its key, as the job is never retried on its own.
  asksFirst?(automationId: string): boolean
}

// The run fails and its key counts a failure, together, so a sweep that stops part way never counts it twice. An
// ask-first job's key is freed instead, so its item is asked again.
function failStart(
  store: PilotStore,
  run: RunRow,
  at: number,
  outcome: string,
  opts: SweepOptions
): number {
  return store.transaction(() => {
    let failures = 0
    if (opts.asksFirst?.(run.automationId)) {
      store.unmarkHandledForRun(run.automationId, run.id)
    } else {
      failures = store.setHandledStatus(run.automationId, run.id, 'failed', at)
    }
    store.runs.update(run.id, { status: 'failed', outcome, finishedAt: at })
    repend(store, run.id)
    return failures
  })
}

// Run, with its key, then step: a failure part way is finished by the next sweep (the step stays 'starting' or
// 'pending' until its own write lands, and a run that already ended keeps its key as its end settled it).
function closeStaleStart(
  store: PilotStore,
  step: StepRow,
  at: number,
  outcome: string,
  opts: SweepOptions
): boolean {
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
  const failures = run && failRun ? failStart(store, run, at, outcome, opts) : 0
  store.runs.updateStep(step.runId, step.idx, { status: 'failed', error: outcome, finishedAt: at })
  if (run && failures > 0) {
    opts.failureCounted?.(store.runs.get(run.id) ?? run, failures)
  }
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
function closeStepless(store: PilotStore, run: RunRow, at: number, opts: SweepOptions): void {
  const failures = failStart(store, run, at, STALE_START_OUTCOME, opts)
  if (failures > 0) {
    opts.failureCounted?.(store.runs.get(run.id) ?? run, failures)
  }
}

// A step is 'starting' with no terminal only while launchAgentTerminal is in flight, 'pending' only while
// its run's workspace is made, and a run has no step only for a moment before that. Past those bounds, the
// process that launched it has stopped (quit or crash): without this the run would hold its once_per key
// forever; its key counts a failure, so the runner retries it. Runs at scheduler start and before every step
// poll. Never throws.
export function sweepStaleStarts(
  store: PilotStore,
  now: () => number,
  log: (message: string) => void,
  opts: SweepOptions = {}
): void {
  const olderThanMs = opts.olderThanMs ?? STALE_START_MS
  const opening = opts.opening ?? (() => false)
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
      closeStepless(store, run, at, opts)
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
      if (closeStaleStart(store, step, at, outcome, opts)) {
        log(`[pilot] run ${step.runId}: ${outcome}`)
      }
    } catch (error) {
      log(`[pilot] couldn't close stale start ${step.runId}/${step.idx}: ${messageOf(error)}`)
    }
  }
}
