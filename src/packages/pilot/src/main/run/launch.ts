import { randomUUID } from 'node:crypto'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { AgentKind, StepDef } from '../../shared/definition/types'
import { runFields } from '../../shared/template'
import type { WorktreeFactDeps } from '../fields/worktree-facts'
import {
  UnrecordedLaunchError,
  type LaunchRequest,
  type LaunchResult
} from '../scheduler/tick-runner'
import type { PilotStore } from '../store/store'
import { stepKindOf } from '../store/store-advance'
import type { RunStore } from '../store/store-runs'
import type { PilotAgentLaunchOptions } from './agent-launch-hook'
import { newestSessionRow } from './agent-rows'
import { runtimeSessionTabs } from './session-tabs'
import {
  launchAgentStep,
  type AgentStepDeps,
  type AgentStepRequest,
  PromptNotSentError,
  type KnownTerminal,
  type SessionTerminals,
  type SessionTerminalState
} from './agent-step'
import { terminalLaunchOptions, type SessionPlan } from './step-launch-plan'
import {
  resolveWorkspace,
  runtimeWorkspaceDeps,
  type Workspace,
  type WorkspaceDeps
} from './workspace'

export type LauncherDeps = AgentStepDeps & {
  workspace: WorkspaceDeps
  // Shell steps (Task 10). Without it, a shell first step can't start.
  startShellStep?: (req: AgentStepRequest) => Promise<LaunchResult>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Best effort: the failure being reported matters more than a second failure while recording it.
function failFirstStep(store: PilotStore, runId: string, error: string, at: number): void {
  try {
    store.runs.updateStep(runId, 0, { status: 'failed', error, finishedAt: at })
  } catch {}
}

// The interim single-step launch (nothing wires it since Task 9c: the tick runner's launch is the run
// engine's startRun, run/engine-wiring.ts). Writes step 0 as `pending` (B8: a slow worktree create must
// not look like a stuck start) stamped now, as the engine does; resolves the run's workspace (item
// worktree, main checkout or a new worktree), records it on the run, then starts step 0 (spec §7). The
// tick runner created the run row (running) first, so a new worktree's claim sees it. A workspace
// failure fails the step with its error; the tick runner then fails the run and frees its key.
export function makeLauncher(
  store: PilotStore,
  deps: LauncherDeps
): (req: LaunchRequest) => Promise<LaunchResult> {
  return async ({ runId, definition, decision }) => {
    const startedAt = store.runs.get(runId)?.startedAt ?? deps.now()
    const fields = {
      ...decision.fields,
      ...runFields({
        automationId: definition.id,
        at: startedAt,
        timezone: definition.timezone,
        runId
      })
    }
    const first = definition.steps[0]
    store.runs.createStep({
      runId,
      idx: 0,
      name: first.name,
      agent: first.agent,
      skill: first.skill,
      startedAt: deps.now(),
      status: 'pending',
      kind: stepKindOf(first.agent),
      mode: first.mode,
      whenExpr: first.when
    })
    const startShell = deps.startShellStep
    // Before the workspace: a run that can't start must not leave a new worktree behind.
    if (first.agent === 'shell' && !startShell) {
      const message = `Step "${first.name}" is a shell step, and this launcher has no shell runner`
      failFirstStep(store, runId, message, deps.now())
      throw new Error(message)
    }
    let workspace: Workspace
    try {
      workspace = await resolveWorkspace(
        { definition, runId, label: decision.label, fields },
        deps.workspace
      )
      store.runs.update(runId, { worktreePath: workspace.path, worktreeId: workspace.worktreeId })
    } catch (error) {
      failFirstStep(store, runId, messageOf(error), deps.now())
      throw error
    }
    const req: AgentStepRequest = {
      runId,
      definition,
      stepIdx: 0,
      itemKey: decision.key,
      label: decision.label,
      fields,
      workspace
    }
    if (first.agent === 'shell' && startShell) {
      return startShell(req)
    }
    return launchAgentStep(store, req, deps)
  }
}

export type AgentSessionMode =
  | { kind: 'new' }
  | { kind: 'resume'; sessionId: string }
  | { kind: 'fork'; sessionId: string }
export type AgentTerminalRequest = {
  runId: string
  stepIdx: number
  stepName: string
  automationId: string
  itemKey: string
  powers: readonly string[]
  worktree: { id: string | null; path: string }
  agent: AgentKind
  prompt: string
  title: string
  args: readonly string[]
  session: AgentSessionMode
}
// sessionId: the id the terminal runs under when Pilot knows it (a pinned new Claude session, a resumed
// one); null for a fork and for a new Codex session, whose ids are learned from the agent's hooks.
export type AgentTerminalResult = {
  terminalHandle: string
  paneKey: string
  sessionId: string | null
}

function planOf(
  agent: AgentKind,
  mode: AgentSessionMode,
  newSessionId: () => string
): Exclude<SessionPlan, { kind: 'missing' }> {
  if (mode.kind === 'new') {
    return { kind: 'fresh', sessionId: agent === 'claude' ? newSessionId() : null }
  }
  return mode
}

// Opens one agent terminal with the §8 env, a new, resumed or forked session and the step's args (R-i).
// The answer dispatcher (Task 24b) uses it; the caller records the terminal on its own step row.
export async function openAgentTerminal(
  runtime: OrcaRuntimeService,
  req: AgentTerminalRequest,
  newSessionId: () => string = randomUUID
): Promise<AgentTerminalResult> {
  const session = planOf(req.agent, req.session, newSessionId)
  // A typed variable, not a literal: `pilot` is beyond launchAgentTerminal's declared options.
  const opts: PilotAgentLaunchOptions = terminalLaunchOptions({
    agent: req.agent,
    prompt: req.prompt,
    title: req.title,
    env: {
      runId: req.runId,
      automationId: req.automationId,
      itemKey: req.itemKey,
      stepName: req.stepName,
      stepIdx: req.stepIdx,
      powers: req.powers
    },
    args: req.args,
    session
  })
  const selector = req.worktree.id ? `id:${req.worktree.id}` : `path:${req.worktree.path}`
  const terminal = await runtime.launchAgentTerminal(selector, opts)
  if (!terminal.paneKey) {
    // The agent started with its prompt, in a terminal nothing can follow.
    throw new UnrecordedLaunchError(terminal.handle, 'the runtime returned no pane to watch')
  }
  return {
    terminalHandle: terminal.handle,
    paneKey: terminal.paneKey,
    sessionId: session.kind === 'fork' ? null : session.sessionId
  }
}

// Until Task 10 reads skills' modes, a step that names one fails instead of running without it.
function modeTextUnavailable(step: StepDef): Promise<string | null> {
  if (step.mode) {
    return Promise.reject(
      new Error(`Step "${step.name}" uses mode "${step.mode}", which Pilot can't read yet`)
    )
  }
  return Promise.resolve(null)
}

type LauncherWorktrees = Pick<
  WorktreeFactDeps,
  'listWorktrees' | 'terminalAlive' | 'paneState' | 'terminalDraft'
>
// The runtime's own word for an agent that can't take a prompt now (RuntimeTerminalAgentStatusState).
const BUSY_STATUS = new Set(['working', 'permission'])
// Title and foreground caches refresh asynchronously, so "no agent here" counts only when it holds for
// about a second: upstream's send guard re-polls the same way (terminal-agent-send-guard.ts).
const AGENT_RECHECKS = 7
const AGENT_RECHECK_MS = 150
type Pause = (ms: number) => Promise<void>
const wait: Pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The foreground agent's status, or null when none shows on any read; a failed read throws.
async function foregroundAgent(runtime: OrcaRuntimeService, handle: string, pause: Pause) {
  for (let check = 0; ; check++) {
    const agent = await runtime.getTerminalAgentStatus(handle)
    if (agent.isRunningAgent) {
      return agent
    }
    if (check === AGENT_RECHECKS) {
      return null
    }
    await pause(AGENT_RECHECK_MS)
  }
}

// H10's look at a session's old terminal (agent-step.ts checks the store first). The draft is read
// from the rendered screen (B6); anything unreadable is busy, never gone.
async function sessionTerminalState(
  runtime: OrcaRuntimeService,
  worktrees: LauncherWorktrees,
  { handle, paneKey }: KnownTerminal,
  sessionId: string,
  pause: Pause
): Promise<SessionTerminalState> {
  if (!paneKey) {
    return 'busy'
  }
  try {
    if (!(await worktrees.terminalAlive(handle, paneKey))) {
      return 'gone'
    }
    // An exited agent leaves a shell: the session isn't running there.
    const agent = await foregroundAgent(runtime, handle, pause)
    if (!agent) {
      return 'gone'
    }
    if (BUSY_STATUS.has(agent.status ?? '') || worktrees.paneState(paneKey) !== 'idle') {
      return 'busy'
    }
    if ((await worktrees.terminalDraft(handle)).trim() !== '') {
      return 'busy'
    }
    const rows = runtime.getAgentStatusRowsForPane(paneKey)
    return newestSessionRow(rows)?.providerSession?.id === sessionId ? 'free' : 'other'
  } catch {
    return 'busy'
  }
}

// The prompt carries item text (MR, branch, Linear), so right before typing it the agent must still be
// in the foreground and idle: never a plain shell or a permission dialog (upstream's send guard asks
// the same). Typed as the driver, then it must start a turn.
async function sendToIdleAgent(
  runtime: OrcaRuntimeService,
  handle: string,
  prompt: string
): Promise<void> {
  const agent = await runtime.getTerminalAgentStatus(handle).catch((error: unknown) => {
    throw new PromptNotSentError(`terminal ${handle} could not be read: ${messageOf(error)}`)
  })
  if (!agent.isRunningAgent || BUSY_STATUS.has(agent.status ?? '')) {
    throw new PromptNotSentError(`terminal ${handle} has no idle agent to take the prompt`)
  }
  const sent = await runtime.sendTerminalAgentPrompt(handle, prompt, {
    inputKind: 'driving',
    observationTimeoutMs: 30_000
  })
  if (!sent.accepted) {
    throw new PromptNotSentError(
      `terminal ${handle} refused the prompt (${sent.refusedReason ?? 'no reason'})`
    )
  }
  // Typed, but no turn seen: the prompt may still be with the agent.
  if (!sent.prompt?.stages.includes('turn_started')) {
    throw new Error("the agent didn't start a turn on the prompt")
  }
}

// Pilot's own idle tab. A process the close couldn't stop would make the resume a second one.
async function closeSessionTerminal(runtime: OrcaRuntimeService, handle: string): Promise<void> {
  const closed = await runtime.closeTerminal(handle)
  if (closed.ptyStopVerdict) {
    throw new Error(`Couldn't close terminal ${handle}: its process is ${closed.ptyStopVerdict}`)
  }
}

// H10's look at, typing into and closing of a session's terminal: the run launcher's, and the answer
// dispatcher's (Task 24b) when it sends answers into the session that asked.
export function runtimeSessionTerminals(
  runtime: OrcaRuntimeService,
  worktrees: LauncherWorktrees,
  pause: Pause = wait
): SessionTerminals {
  return {
    state: (terminal, id) => sessionTerminalState(runtime, worktrees, terminal, id, pause),
    tabs: runtimeSessionTabs(runtime),
    send: (handle, prompt) => sendToIdleAgent(runtime, handle, prompt),
    close: (handle) => closeSessionTerminal(runtime, handle)
  }
}

// `runs` is the run store a new worktree's claim reads and writes (Task 8b); `pause` is for tests.
export function runtimeLauncherDeps(
  runtime: OrcaRuntimeService,
  worktrees: LauncherWorktrees,
  now: () => number,
  runs: RunStore,
  pause: Pause = wait
): LauncherDeps {
  return {
    workspace: runtimeWorkspaceDeps(runtime, (repoPath) => worktrees.listWorktrees(repoPath), runs),
    // opts carries `pilot` (env, argv); the agent-launch-env hook applies it to this launch only.
    // Orca's sleeping-agent record keeps its own launchConfig, so an agent Orca wakes later resumes
    // its session without PILOT_* env or the step's args (by then the step is usually closed).
    launchTerminal: (selector, opts) => runtime.launchAgentTerminal(selector, opts),
    modeText: modeTextUnavailable,
    newSessionId: () => randomUUID(),
    now,
    sessionTerminals: runtimeSessionTerminals(runtime, worktrees, pause)
  }
}
