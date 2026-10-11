import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { PilotStore } from '../store/store'
import type { CostReader } from './cost'

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

// Errors that mean the terminal will never come back (throw sites in src/main/runtime):
// - terminal_handle_stale: build-pty-terminal-summary, resolve-terminal-pane (showTerminal) and others
// - terminal_unsupported_for_agent_session: structured-worker-terminal-refusal, carried as `code`
//   (the message is prose); this is what a pre-restart handle throws
// - terminal_not_found: resolve-terminal-pane, serialize-main-terminal-buffer
// Anything else (runtime_unavailable during startup or a renderer reload, unknown errors) is
// transient: the probe rethrows and the step is left alone this cycle.
const GONE_CODES = new Set([
  'terminal_handle_stale',
  'terminal_unsupported_for_agent_session',
  'terminal_not_found'
])

function isGone(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const code = (error as { code?: unknown }).code
  return GONE_CODES.has(error.message) || (typeof code === 'string' && GONE_CODES.has(code))
}

export function runtimeStepProbe(runtime: OrcaRuntimeService): StepProbe {
  return {
    async status(handle, paneKey) {
      const row = runtime.getAgentStatusRowsForPane(paneKey)[0]
      if (row) {
        return STATE_MAP[row.state] ?? 'working'
      }
      try {
        await runtime.showTerminal(handle)
        return 'working'
      } catch (error) {
        if (isGone(error)) {
          return 'gone'
        }
        throw error
      }
    },
    session(paneKey) {
      const s = runtime.getAgentStatusRowsForPane(paneKey)[0]?.providerSession
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
    store.runs.updateStep(step.runId, step.idx, {
      status: 'done',
      finishedAt: at,
      costUsd: spent.costUsd,
      tokens: spent.tokens
    })
    store.runs.update(step.runId, {
      status: 'done',
      finishedAt: at,
      outcome: 'Done',
      costUsd: spent.costUsd,
      tokens: spent.tokens
    })
  }
  if (state === 'gone') {
    const error = 'The terminal closed before the agent finished'
    const at = now()
    store.runs.updateStep(step.runId, step.idx, { status: 'failed', finishedAt: at, error })
    store.runs.update(step.runId, { status: 'failed', finishedAt: at, outcome: error })
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
