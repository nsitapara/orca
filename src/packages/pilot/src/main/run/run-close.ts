import type { HandledStatus, RunRow, TickTrigger } from '../../shared/api-types'
import { homeOf } from '../../shared/api-types-env'
import type { EndedStep, RunEnd } from '../../shared/run/step-plan'
import type { FailureCounted } from '../capacity/give-up'
import { repend } from '../handover/repend'
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
  // After a failed end counted a failure on the run's key (the give-up card).
  failureCounted?: FailureCounted
}
export type CloseOptions = {
  // The run's ended steps: each broken `always` step is also recorded as an event (H3).
  ended?: EndedStep[]
  // The once_per key's settled status, when it isn't the end status's (an orphaned agent's run).
  handled?: HandledStatus
  // Nothing ran (a deferred env; a first step that couldn't start once its env was made): the once_per key is freed, the
  // handed-over ids it took are pending again, and nothing is handed on.
  release?: boolean
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

// Ends a run: its status, outcome and end time, cost and tokens summed over its steps, its once_per key (a failed or
// timed-out run's key is failed, counting a failure for the runner's retry; a released run's is freed; any other is
// done) and its handover, in one transaction; then the handover's triggers, failureCounted, an `always_step_failed`
// event per broken `always` step (H3: never on the run itself), then onRunEnd.
export function closeRun(
  deps: RunCloseDeps,
  run: RunRow,
  end: RunEnd,
  opts: CloseOptions = {}
): void {
  const { store } = deps
  const at = deps.now()
  const spent = store.advance.rollupCost(run.id)
  const settled = opts.handled ?? (broke(end.status) ? 'failed' : 'done')
  let failures = 0
  // One transaction: the run's end, its once_per key and what it hands over. A failed write rolls all three back and
  // throws, so the run stays running and the next advance closes it again.
  const written = store.transaction(() => {
    const handed = opts.release ? null : (deps.handover?.write(run, end) ?? null)
    store.runs.update(run.id, {
      status: end.status,
      outcome: handed?.note ? `${end.outcome}; ${handed.note}` : end.outcome,
      finishedAt: at,
      costUsd: spent.costUsd,
      tokens: spent.tokens
    })
    if (opts.release) {
      repend(store, run.id)
      store.unmarkHandledForRun(run.automationId, run.id)
    } else {
      failures = store.setHandledStatus(run.automationId, run.id, settled, at)
    }
    return handed
  })
  if (written && deps.handover) {
    try {
      deps.handover.after(written)
    } catch (error) {
      deps.log(`[pilot] run ${run.id}: couldn't trigger the next stage: ${messageOf(error)}`)
    }
  }
  if (settled === 'failed' && failures > 0) {
    try {
      deps.failureCounted?.(store.runs.get(run.id) ?? run, failures)
    } catch (error) {
      deps.log(`[pilot] run ${run.id}: failureCounted failed: ${messageOf(error)}`)
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
