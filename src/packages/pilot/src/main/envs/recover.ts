import type { RunRow } from '../../shared/api-types'
import type { RunEnd } from '../../shared/run/step-plan'
import type { CloseOptions } from '../run/run-close'
import type { PilotStore } from '../store/store'
import { STOPPED } from './prepare'

export const RECOVERED_OUTCOME = "Couldn't prepare its workspace: Pilot stopped while making it"

export type RecoverDeps = {
  store: PilotStore
  now(): number
  // A create this process is running for the run (Preparations.isPreparing).
  isPreparing(runId: string): boolean
  preparerGone(preparer: { pid: number; identity: string | null } | undefined): boolean
  stopOrphanCreate(runId: string): Promise<void>
  // closeRun with the env service's runEnded, so the run's answers hook and its env's teardown follow.
  close(run: RunRow, end: RunEnd, opts: CloseOptions): void
  log(message: string): void
}

// The run's first step, still pending while its env was made, fails with it: nothing ran.
function failFirstStep(deps: RecoverDeps, runId: string): void {
  const step = deps.store.runs.steps(runId).find((s) => s.idx === 0)
  if (step?.status === 'pending') {
    deps.store.runs.updateStep(runId, 0, {
      status: 'failed',
      error: RECOVERED_OUTCOME,
      finishedAt: deps.now()
    })
  }
}

// At startup, before the sweep: what a stopped Pilot left while it made an env, which no live Pilot prepares now. An env
// still preparing (its create may still run), or a run still running whose create a quit stopped (Preparations.stopAll)
// with nothing to close the run. Its create is stopped, its env reads failed (so teardown deletes it), and a run still
// running closes failed without retry_after_failure (nothing ran).
export async function recoverPreparing(deps: RecoverDeps): Promise<number> {
  let recovered = 0
  // Read before anything is awaited: at startup no run of this process is in it yet.
  for (const left of deps.store.runs.envs.leftPreparing(STOPPED)) {
    if (
      deps.isPreparing(left.id) ||
      !deps.preparerGone(deps.store.runs.envs.json(left.id).preparer)
    ) {
      continue
    }
    await deps.stopOrphanCreate(left.id)
    deps.store.runs.envs.settle(left.id, 'failed', RECOVERED_OUTCOME)
    // Read again after the wait (Ruling P13): a run something else closed meanwhile (the stale sweep, a cancel) is never
    // closed twice. Nothing is awaited between this read and the close.
    const run = deps.store.runs.get(left.id)
    if (run?.status === 'running') {
      failFirstStep(deps, run.id)
      deps.close(run, { status: 'failed', outcome: RECOVERED_OUTCOME }, { release: true })
    }
    deps.log(`[pilot] run ${left.id}: ${RECOVERED_OUTCOME}`)
    recovered += 1
  }
  return recovered
}
