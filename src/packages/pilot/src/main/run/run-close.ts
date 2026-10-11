import type { HandledStatus, RunRow } from '../../shared/api-types'
import type { EndedStep, RunEnd } from '../../shared/run/step-plan'
import type { PilotStore } from '../store/store'
import { broke } from './advance-fields'

export type RunCloseDeps = {
  store: PilotStore
  now(): number
  log(message: string): void
  // Called once when a run reaches its end status.
  onRunEnd?(run: RunRow, end: RunEnd): void
}
export type CloseOptions = {
  // The run's ended steps: each broken `always` step is also recorded as an event (H3).
  ended?: EndedStep[]
  // The once_per key's settled status, when it isn't the end status's (an orphaned agent's run).
  handled?: HandledStatus
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A timeline event about a run (events table, contract §9).
export function addRunEvent(
  store: PilotStore,
  at: number,
  run: RunRow,
  kind: string,
  payload: Record<string, unknown>
): void {
  store.events.add({
    at,
    kind,
    automationId: run.automationId,
    runId: run.id,
    worktreePath: run.worktreePath,
    itemKey: run.itemKey,
    payload
  })
}

// Ends a run: its status, outcome and end time, cost and tokens summed over its steps, its once_per
// key (a failed or timed-out run's key is failed, for retry_after_failure; any other is done), an
// `always_step_failed` event per broken `always` step (H3: never on the run itself), then onRunEnd.
export function closeRun(
  deps: RunCloseDeps,
  run: RunRow,
  end: RunEnd,
  opts: CloseOptions = {}
): void {
  const { store } = deps
  const at = deps.now()
  const spent = store.advance.rollupCost(run.id)
  store.runs.update(run.id, {
    status: end.status,
    outcome: end.outcome,
    finishedAt: at,
    costUsd: spent.costUsd,
    tokens: spent.tokens
  })
  const failed = broke(end.status)
  store.setHandledStatus(run.automationId, run.id, opts.handled ?? (failed ? 'failed' : 'done'), at)
  for (const step of opts.ended ?? []) {
    if (step.always && broke(step.status)) {
      const payload = { step: step.name, status: step.status, error: step.error }
      addRunEvent(store, at, run, 'always_step_failed', payload)
    }
  }
  if (deps.onRunEnd) {
    try {
      deps.onRunEnd(store.runs.get(run.id) ?? run, end)
    } catch (error) {
      deps.log(`[pilot] run ${run.id}: onRunEnd failed: ${messageOf(error)}`)
    }
  }
}
