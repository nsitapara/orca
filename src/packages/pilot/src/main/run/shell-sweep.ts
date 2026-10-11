import type { PilotStore } from '../store/store'

// A shell step 'running' with no process in this Pilot belonged to a Pilot that has stopped: its
// process went with it. The step fails; advanceIdle then ends the run (always steps still run).
export const ORPHAN_SHELL_OUTCOME = 'Pilot stopped while this shell step ran'

export function sweepOrphanShellSteps(
  store: PilotStore,
  isLive: (runId: string, idx: number) => boolean,
  now: () => number,
  log: (message: string) => void
): void {
  let steps: ReturnType<PilotStore['runs']['runningSteps']>
  try {
    steps = store.runs.runningSteps()
  } catch (error) {
    log(`[pilot] couldn't sweep shell steps: ${messageOf(error)}`)
    return
  }
  for (const step of steps) {
    if (step.kind !== 'shell' || step.status !== 'running' || isLive(step.runId, step.idx)) {
      continue
    }
    try {
      store.runs.updateStep(step.runId, step.idx, {
        status: 'failed',
        finishedAt: now(),
        error: ORPHAN_SHELL_OUTCOME
      })
      log(`[pilot] run ${step.runId}: step ${step.name}: ${ORPHAN_SHELL_OUTCOME}`)
    } catch (error) {
      log(`[pilot] couldn't close shell step ${step.runId}/${step.idx}: ${messageOf(error)}`)
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
