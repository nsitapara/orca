import type { RunRow, StepRow, StopRunResult } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { RunEnd } from '../../shared/run/step-plan'
import { STOPPED_BY_YOU } from '../../shared/run/stopped-run'
import type { PilotStore } from '../store/store'
import { endedSteps, nextIdx, rowFor } from './advance-fields'
import type { CloseOptions } from './run-close'
import { isTerminalGoneError, type TerminalRelist } from './terminal-relist'

export const NOT_RUN_STOPPED = 'Not run: the run was stopped'
// The shell runner has no way to stop its process (shell-step.ts).
export const SHELL_STEP_RUNNING = 'A shell step is running; it stops when its command exits'

export type RunStopDeps = {
  store: PilotStore
  now(): number
  definitionFor(automationId: string): AutomationDefinition | null
  closeTerminal(handle: string): Promise<void>
  relist: TerminalRelist
  // The engine's close: the run's end, its once_per key, its handover and its run-end hooks.
  close(run: RunRow, end: RunEnd, opts?: CloseOptions): void
}

// The engine's one-walk-per-run lock (advance.ts) and the runs it holds.
export type RunLock = {
  busy: ReadonlySet<string>
  locked(runId: string, work: () => Promise<void>): Promise<void>
}

const ACTIVE: ReadonlySet<StepRow['status']> = new Set(['starting', 'running'])

function startingStep(runId: string): StopRunResult {
  return { stopped: false, reason: `Run ${runId} is starting a step; try Stop again in a moment` }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A stale handle may be a live agent's from before a restart (terminal-relist.ts): only a fresh listing proves it gone.
async function closeTab(deps: RunStopDeps, step: StepRow): Promise<void> {
  const handle = step.terminalHandle
  if (!handle) {
    return
  }
  try {
    await deps.closeTerminal(handle)
    return
  } catch (error) {
    if (!isTerminalGoneError(error)) {
      throw error
    }
  }
  let listed: boolean
  try {
    listed = await deps.relist(handle, step.paneKey)
  } catch (error) {
    throw new Error(
      `Pilot can't tell whether the agent in terminal ${handle} stopped: ${messageOf(error)}`
    )
  }
  // The listing re-adopted the live handle, so the close can reach it now.
  if (listed) {
    await deps.closeTerminal(handle)
  }
}

// The active steps fail, and every step that never ran is skipped, `always` ones too: nothing runs after a Stop.
function settleSteps(
  store: PilotStore,
  run: RunRow,
  def: AutomationDefinition | null,
  rows: StepRow[],
  at: number
): void {
  const steps = def?.steps ?? []
  store.transaction(() => {
    for (const row of rows) {
      if (ACTIVE.has(row.status)) {
        // The watcher may have detached it while its tab closed: that session is gone now.
        store.runs.updateStep(run.id, row.idx, {
          status: 'failed',
          error: STOPPED_BY_YOU,
          finishedAt: at,
          detached: false
        })
      } else if (row.status === 'pending') {
        store.runs.updateStep(run.id, row.idx, {
          status: 'skipped',
          error: NOT_RUN_STOPPED,
          finishedAt: at
        })
      }
    }
    for (let idx = nextIdx(rows); idx < steps.length; idx += 1) {
      store.advance.recordSkippedStep(rowFor(run.id, idx, steps[idx], at), NOT_RUN_STOPPED)
    }
  })
}

// The agent's tab closes (a detached step is done, and its session isn't the run's to close), then the run ends
// cancelled through the engine's close, so its key is settled done (no automatic retry) and its run-end hooks run as on
// any end. The run and its steps change only once every tab closed.
async function stopRunNow(deps: RunStopDeps, runId: string): Promise<StopRunResult> {
  const { store } = deps
  const notRunning: StopRunResult = { stopped: false, reason: `Run ${runId} isn't running` }
  if (store.runs.get(runId)?.status !== 'running') {
    return notRunning
  }
  const rows = store.runs.steps(runId)
  const active = rows.filter((r) => ACTIVE.has(r.status))
  // An answer run launches outside the engine's lock: only its `starting` step shows the launch under way.
  if (active.some((r) => r.status === 'starting')) {
    return startingStep(runId)
  }
  if (active.some((r) => r.kind === 'shell')) {
    return { stopped: false, reason: SHELL_STEP_RUNNING }
  }
  for (const step of active) {
    await closeTab(deps, step)
  }
  // A sweep outside the lock may have ended the run while its tab closed: it is never closed twice.
  const current = store.runs.get(runId)
  if (current?.status !== 'running') {
    return notRunning
  }
  // An answer run's steps aren't the definition's.
  const def = current.trigger === 'answer' ? null : deps.definitionFor(current.automationId)
  settleSteps(store, current, def, rows, deps.now())
  const ended = endedSteps(store.runs.steps(runId), def)
  deps.close(current, { status: 'cancelled', outcome: STOPPED_BY_YOU }, { ended })
  return { stopped: true }
}

// Stop runs under the engine's per-run lock and never waits for it: a walk holding it may be starting a step, and a
// Stop beside that launch would miss its agent. Never throws.
export async function stopUnderLock(
  deps: RunStopDeps,
  lock: RunLock,
  runId: string
): Promise<StopRunResult> {
  let result = startingStep(runId)
  if (!lock.busy.has(runId)) {
    await lock.locked(runId, async () => {
      result = await stopRunNow(deps, runId).catch((error: unknown): StopRunResult => ({
        stopped: false,
        reason: messageOf(error)
      }))
    })
  }
  return result
}
