import type { HandledStatus, RunRow, TickTrigger } from '../../shared/api-types'
import { homeOf } from '../../shared/api-types-env'
import type { EndedStep, RunEnd } from '../../shared/run/step-plan'
import type { PilotStore } from '../store/store'
import { broke } from './advance-fields'

// What a run's end hands the next stage of its job (main/handover): `write` runs inside the transaction that ends the
// run, so the handover rows commit with the run's end or not at all; its note joins the run's outcome. `after` runs
// once that transaction committed (a feed's run: now), and the rows are already safe when it fails.
export type HandoverWrite = { note: string | null; triggers: { to: string; cause: TickTrigger }[] }
export type RunEndHandover = {
  write(run: RunRow, end: RunEnd): HandoverWrite
  after(written: HandoverWrite): void
}
export type RunCloseDeps = {
  store: PilotStore
  now(): number
  log(message: string): void
  // Called once when a run reaches its end status.
  onRunEnd?(run: RunRow, end: RunEnd): void
  handover?: RunEndHandover
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
    worktreePath: homeOf(run),
    itemKey: run.itemKey,
    payload
  })
}

// Ends a run: its status, outcome and end time, cost and tokens summed over its steps, its once_per
// key (a failed or timed-out run's key is failed, for retry_after_failure; any other is done) and its handover, in one
// transaction; then the handover's triggers, an `always_step_failed` event per broken `always` step (H3: never on the
// run itself), then onRunEnd.
export function closeRun(
  deps: RunCloseDeps,
  run: RunRow,
  end: RunEnd,
  opts: CloseOptions = {}
): void {
  const { store } = deps
  const at = deps.now()
  const spent = store.advance.rollupCost(run.id)
  const failed = broke(end.status)
  // One transaction: the run's end, its once_per key and what it hands over. A failed write rolls all three back and
  // throws, so the run stays running and the next advance closes it again.
  const written = store.transaction(() => {
    const handed = deps.handover?.write(run, end) ?? null
    store.runs.update(run.id, {
      status: end.status,
      outcome: handed?.note ? `${end.outcome}; ${handed.note}` : end.outcome,
      finishedAt: at,
      costUsd: spent.costUsd,
      tokens: spent.tokens
    })
    store.setHandledStatus(
      run.automationId,
      run.id,
      opts.handled ?? (failed ? 'failed' : 'done'),
      at
    )
    return handed
  })
  if (written && deps.handover) {
    try {
      deps.handover.after(written)
    } catch (error) {
      deps.log(`[pilot] run ${run.id}: couldn't trigger the next stage: ${messageOf(error)}`)
    }
  }
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
