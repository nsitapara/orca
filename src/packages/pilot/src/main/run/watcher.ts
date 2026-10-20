import { sessionPatch } from './session-pin'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { formatDuration } from '../../shared/run/format-duration'
import type { PilotStore } from '../store/store'
import { newestLiveRow, newestSessionRow, observedState, type ObservedState } from './agent-rows'
import type { CostReader } from './cost'
import { isTerminalGoneError, terminalRelister, type TerminalRelist } from './terminal-relist'

export type { ObservedState }
export type StepProbe = {
  // `since`: only rows received from then on are the step's (an earlier step's turn in the same
  // terminal isn't); without one, every row counts.
  status(handle: string, paneKey: string, since?: number | null): Promise<ObservedState>
  // `since`: only rows whose state began from then on are the step's (a fresh Codex step in a reused tab must
  // not pin the previous session's id).
  session(
    paneKey: string,
    since?: number | null
  ): { id: string; transcriptPath: string | null } | null
  // Whether the session has sent any hook row since `since` (SessionStart's included): it is up.
  started(paneKey: string, since?: number | null): boolean
}

function rowsSince<R extends { stateStartedAt?: number; receivedAt: number }>(
  rows: readonly R[],
  since: number | null | undefined
): R[] {
  return since === null || since === undefined
    ? [...rows]
    : rows.filter((r) => (r.stateStartedAt ?? r.receivedAt) >= since)
}

export function runtimeStepProbe(
  runtime: OrcaRuntimeService,
  relist: TerminalRelist = terminalRelister(runtime)
): StepProbe {
  return {
    async status(handle, paneKey, since) {
      const rows = runtime.getAgentStatusRowsForPane(paneKey)
      // Keyed on when the row's state began, not receivedAt: the hook server re-stamps receivedAt on a
      // same-state refresh, so an earlier turn's `done` row would otherwise look like this step's.
      const row = newestLiveRow(rowsSince(rows, since))
      if (row) {
        return observedState(row)
      }
      try {
        await runtime.showTerminal(handle)
        return 'working'
      } catch (error) {
        if (!isTerminalGoneError(error)) {
          throw error
        }
        // After an app restart a terminal the daemon still hosts looks stale too: ask the PTY host's
        // inventory before closing the run (terminal-relist.ts). If it can't say, the step waits.
        if (await relist(handle, paneKey)) {
          return 'working'
        }
        return 'gone'
      }
    },
    session(paneKey, since) {
      const rows = runtime.getAgentStatusRowsForPane(paneKey)
      const s = newestSessionRow(rowsSince(rows, since))?.providerSession
      if (!s?.id) {
        return null
      }
      return { id: s.id, transcriptPath: s.transcriptPath ?? null }
    },
    started(paneKey, since) {
      const rows = runtime.getAgentStatusRowsForPane(paneKey)
      return rowsSince(rows, since).some((r) => !r.providerSessionOnly && !r.restoredUnconfirmed)
    }
  }
}

type OpenStep = ReturnType<PilotStore['runs']['runningSteps']>[number]
type StepPatch = Parameters<PilotStore['runs']['updateStep']>[2]

export type StepPollHooks = {
  // The step's timeout in ms, or null for none (contract §7: its own, else limits.timeout).
  timeoutOf(step: OpenStep): number | null
  // The step is `wait: start`: it ends done, detached, once its session is up.
  endsAtStart(step: OpenStep): boolean
  closeTerminal(handle: string): Promise<void>
  // The step ended (done, failed or timed out): the run engine starts the next step or ends the run.
  onStepEnded(runId: string): Promise<void>
  // The step's session id was just learned from its hooks (a Codex step, whose CLI can't take one).
  sessionLearned?(step: OpenStep, sessionId: string): void
}

const GONE = 'The terminal closed before the agent finished'

// The row first: if the engine then throws, the step stays ended and advanceIdle picks the run up.
async function endStep(
  store: PilotStore,
  step: OpenStep,
  patch: StepPatch,
  hooks: StepPollHooks
): Promise<void> {
  store.runs.updateStep(step.runId, step.idx, patch)
  await hooks.onStepEnded(step.runId)
}

// Past its timeout, a working or waiting agent alike: its terminal is closed and the step times out.
// A close that fails for any reason but "already gone" leaves the step for the next poll.
async function timeOutIfDue(
  store: PilotStore,
  step: OpenStep,
  handle: string,
  state: ObservedState,
  now: () => number,
  hooks: StepPollHooks
): Promise<void> {
  const limit = hooks.timeoutOf(step)
  if (limit === null || step.startedAt === null || now() - step.startedAt < limit) {
    return
  }
  try {
    await hooks.closeTerminal(handle)
  } catch (error) {
    if (!isTerminalGoneError(error)) {
      throw error
    }
  }
  const waited = state === 'waiting' ? ' while it waited in its tab' : ''
  await endStep(
    store,
    step,
    {
      status: 'timed_out',
      finishedAt: now(),
      error: `Timed out after ${formatDuration(limit)}${waited}`
    },
    hooks
  )
}

async function endDone(
  store: PilotStore,
  step: OpenStep,
  session: ReturnType<StepProbe['session']>,
  cost: CostReader,
  now: () => number,
  hooks: StepPollHooks,
  detached: boolean
): Promise<void> {
  const path = session?.transcriptPath ?? step.transcriptPath
  // Only a provisional Claude cost is read here; measureFinishedSteps (usage/) overwrites it, for both agents, with
  // the step's own window.
  const spent = path && step.agent === 'claude' ? await cost(path) : { costUsd: null, tokens: null }
  const patch: StepPatch = {
    status: 'done',
    finishedAt: now(),
    costUsd: spent.costUsd,
    tokens: spent.tokens
  }
  await endStep(store, step, detached ? { ...patch, detached: true } : patch, hooks)
}

async function pollStep(
  store: PilotStore,
  step: OpenStep,
  probe: StepProbe,
  cost: CostReader,
  now: () => number,
  hooks: StepPollHooks
): Promise<void> {
  const handle = step.terminalHandle
  if (!handle || !step.paneKey) {
    return
  }
  const session = probe.session(step.paneKey, step.startedAt)
  const patch = sessionPatch(step, session)
  if (patch) {
    store.runs.updateStep(step.runId, step.idx, patch)
    if (patch.sessionId) {
      hooks.sessionLearned?.(step, patch.sessionId)
    }
  }
  if (hooks.endsAtStart(step) && probe.started(step.paneKey, step.startedAt)) {
    await endDone(store, step, session, cost, now, hooks, true)
    return
  }
  const state = await probe.status(handle, step.paneKey, step.startedAt)
  if (state === 'done') {
    await endDone(store, step, session, cost, now, hooks, false)
    return
  }
  if (state === 'gone') {
    await endStep(store, step, { status: 'failed', finishedAt: now(), error: GONE }, hooks)
    return
  }
  await timeOutIfDue(store, step, handle, state, now, hooks)
}

// Called every scheduler pass. A step is done when the agent reports done (Stop hook); the run engine
// decides what comes next. One step's error leaves that step for the next pass and never stops the others.
export async function pollRunningSteps(
  store: PilotStore,
  probe: StepProbe,
  cost: CostReader,
  now: () => number,
  hooks: StepPollHooks
): Promise<void> {
  for (const step of store.runs.runningSteps()) {
    try {
      await pollStep(store, step, probe, cost, now, hooks)
    } catch (error) {
      console.error(
        `pilot: couldn't poll step ${step.runId}/${step.idx}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
