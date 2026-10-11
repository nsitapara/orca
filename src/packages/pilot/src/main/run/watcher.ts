import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { PilotStore } from '../store/store'
import type { CostReader } from './cost'
import { isTerminalGoneError, terminalRelister, type TerminalRelist } from './terminal-relist'

export type ObservedState = 'working' | 'waiting' | 'done' | 'gone'
export type StepProbe = {
  status(handle: string, paneKey: string): Promise<ObservedState>
  session(paneKey: string): { id: string; transcriptPath: string | null } | null
}

const STATE_MAP: Record<string, ObservedState> = {
  working: 'working',
  blocked: 'waiting',
  waiting: 'waiting',
  done: 'done'
}

type Row = ReturnType<OrcaRuntimeService['getAgentStatusRowsForPane']>[number]

// Mirrors upstream's selectRuntimeHookAgentRowForPane "live" rule: newest by receivedAt, ignoring
// provider-session-only and restored-unconfirmed rows (neither proves the agent is live).
function newestLiveRow(rows: readonly Row[]): Row | null {
  let best: Row | null = null
  for (const row of rows) {
    if (row.providerSessionOnly === true || row.restoredUnconfirmed === true) {
      continue
    }
    if (!best || row.receivedAt > best.receivedAt) {
      best = row
    }
  }
  return best
}

function newestSessionRow(rows: readonly Row[]): Row | null {
  let best: Row | null = null
  for (const row of rows) {
    if (row.providerSession && (!best || row.receivedAt > best.receivedAt)) {
      best = row
    }
  }
  return best
}

function observed(row: Row): ObservedState {
  // Claude's SessionStart writes done + sessionBoundary before the prompt lands: not a turn end.
  if (row.state === 'done' && row.sessionBoundary === true) {
    return 'working'
  }
  return STATE_MAP[row.state] ?? 'working'
}

export function runtimeStepProbe(
  runtime: OrcaRuntimeService,
  relist: TerminalRelist = terminalRelister(runtime)
): StepProbe {
  return {
    async status(handle, paneKey) {
      const row = newestLiveRow(runtime.getAgentStatusRowsForPane(paneKey))
      if (row) {
        return observed(row)
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
    session(paneKey) {
      const s = newestSessionRow(runtime.getAgentStatusRowsForPane(paneKey))?.providerSession
      if (!s?.id) {
        return null
      }
      return { id: s.id, transcriptPath: s.transcriptPath ?? null }
    }
  }
}

type OpenStep = ReturnType<PilotStore['runs']['runningSteps']>[number]

async function pollStep(
  store: PilotStore,
  step: OpenStep,
  probe: StepProbe,
  cost: CostReader,
  now: () => number
): Promise<void> {
  if (!step.terminalHandle || !step.paneKey) {
    return
  }
  const session = probe.session(step.paneKey)
  if (session && session.id !== step.sessionId) {
    const patch = session.transcriptPath
      ? { sessionId: session.id, transcriptPath: session.transcriptPath }
      : { sessionId: session.id }
    store.runs.updateStep(step.runId, step.idx, patch)
  }
  const state = await probe.status(step.terminalHandle, step.paneKey)
  if (state === 'done') {
    const path = session?.transcriptPath ?? step.transcriptPath
    // Codex cost is unknown in M1: the run shows, with cost "—".
    const spent =
      path && step.agent === 'claude' ? await cost(path) : { costUsd: null, tokens: null }
    const at = now()
    // Run first: if it throws the step stays open and the next poll retries both writes.
    store.runs.update(step.runId, {
      status: 'done',
      finishedAt: at,
      outcome: 'Done',
      costUsd: spent.costUsd,
      tokens: spent.tokens
    })
    store.runs.updateStep(step.runId, step.idx, {
      status: 'done',
      finishedAt: at,
      costUsd: spent.costUsd,
      tokens: spent.tokens
    })
  }
  if (state === 'gone') {
    const error = 'The terminal closed before the agent finished'
    const at = now()
    store.runs.update(step.runId, { status: 'failed', finishedAt: at, outcome: error })
    store.runs.updateStep(step.runId, step.idx, { status: 'failed', finishedAt: at, error })
  }
}

// Called every poll interval by the scheduler. A step is done when the agent reports done (Stop hook).
// One step's probe error leaves that step untouched this cycle and never stops the others.
export async function pollRunningSteps(
  store: PilotStore,
  probe: StepProbe,
  cost: CostReader,
  now: () => number
): Promise<void> {
  for (const step of store.runs.runningSteps()) {
    try {
      await pollStep(store, step, probe, cost, now)
    } catch (error) {
      console.error(
        `pilot: couldn't poll step ${step.runId}/${step.idx}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
