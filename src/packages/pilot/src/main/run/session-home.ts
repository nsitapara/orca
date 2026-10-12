import type { StepRow } from '../../shared/api-types'
import { SESSION_LOOKBACK_MS } from '../fields/runtime-facts'
import type { PilotStore } from '../store/store'
import type {
  AgentStepDeps,
  AgentStepRequest,
  KnownTerminal,
  SessionTerminals,
  SessionTerminalState
} from './agent-step'
import { findLiveTab } from './session-tabs'
import { stepTitle } from './step-launch-plan'

// H10: the newest step that ran this session in a terminal: in this run for `continue`, among this
// automation's steps in this worktree for `per_worktree`.
function lastSessionStep(
  store: PilotStore,
  req: AgentStepRequest,
  sessionId: string,
  now: number
): StepRow | undefined {
  const { definition, runId, workspace } = req
  const steps =
    definition.steps[req.stepIdx].session.kind === 'continue'
      ? store.runs.steps(runId)
      : store.runs.sessionStepsIn(definition.id, workspace.path, now - SESSION_LOOKBACK_MS)
  return steps.findLast((s) => s.sessionId === sessionId && s.terminalHandle !== null)
}

// A throwing look counts as busy: never a second process on a session that might be in use.
async function lookAt(
  deps: AgentStepDeps,
  terminal: KnownTerminal,
  sessionId: string
): Promise<SessionTerminalState> {
  try {
    return (await deps.sessionTerminals?.state(terminal, sessionId)) ?? 'gone'
  } catch {
    return 'busy'
  }
}

function sameArgs(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((arg, i) => arg === b[i])
}

// H10, one process per session: the step's prompt goes into the terminal its session last ran in when
// that is free and its process runs with this step's args (as stored at launch, not as the definition
// now says: it may have reloaded since). An idle Pilot tab that can't take it (other or unknown args,
// another session) is closed first; a busy one fails the step. Null: open a new terminal.
// An unreadable input counts as a draft: never close a tab whose input can't be seen.
async function hasDraft(terminals: SessionTerminals, handle: string): Promise<boolean> {
  if (!terminals.draft) {
    return false
  }
  try {
    return (await terminals.draft(handle)).trim() !== ''
  } catch {
    return true
  }
}

export async function sessionHome(
  store: PilotStore,
  req: AgentStepRequest,
  sessionId: string,
  deps: AgentStepDeps
): Promise<(KnownTerminal & { launchArgs: string[] }) | null> {
  const prior = lastSessionStep(store, req, sessionId, deps.now())
  const stepOn = (handle: string): boolean =>
    store.runs.runningSteps().some((s) => s.terminalHandle === handle)
  const old = prior?.terminalHandle
    ? { handle: prior.terminalHandle, paneKey: prior.paneKey }
    : null
  // The store before any probe: a Pilot step starting or running there is busy, whatever it shows.
  let state: SessionTerminalState = 'gone'
  if (old) {
    state = stepOn(old.handle) ? 'busy' : await lookAt(deps, old, sessionId)
  }
  if ((state === 'gone' || state === 'other') && deps.sessionTerminals) {
    // No row-named tab holds it: a tab Resume opened, another run's, or the person's may still.
    const elsewhere = await findLiveTab(
      { state: (t, id) => lookAt(deps, t, id), tabs: deps.sessionTerminals.tabs, stepOn },
      sessionId,
      [],
      new Set(old ? [old.handle] : [])
    )
    if (elsewhere?.state === 'busy') {
      throw new Error(`Session ${sessionId} is busy in terminal ${elsewhere.handle}`)
    }
    if (elsewhere) {
      // Someone may have started typing since the look: that tab is busy, never closed under them.
      if (await hasDraft(deps.sessionTerminals, elsewhere.handle)) {
        throw new Error(`Session ${sessionId} is busy in terminal ${elsewhere.handle}`)
      }
      // Its process's args aren't recorded: an idle tab that can't be trusted is closed, then resumed.
      await deps.sessionTerminals.close(elsewhere.handle)
    }
  }
  if (!old || !prior) {
    return null
  }
  const priorStep = req.definition.steps.find((s) => s.name === prior.name)
  if (state === 'busy') {
    const label = store.runs.get(prior.runId)?.itemLabel ?? req.label
    const title = priorStep ? stepTitle(req.definition, priorStep, label) : `terminal ${old.handle}`
    throw new Error(`Session ${sessionId} is busy in ${title}`)
  }
  if (state === 'gone' || !deps.sessionTerminals) {
    return null
  }
  const launchArgs = prior.launchArgs
  if (
    state === 'free' &&
    launchArgs &&
    sameArgs(launchArgs, req.definition.steps[req.stepIdx].args)
  ) {
    return { ...old, launchArgs }
  }
  await deps.sessionTerminals.close(old.handle)
  return null
}
