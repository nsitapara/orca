import { randomUUID } from 'node:crypto'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { AgentKind, StepDef } from '../../shared/definition/types'
import type { WorktreeFactDeps } from '../fields/worktree-facts'
import { UnrecordedLaunchError, type LaunchResult } from '../scheduler/tick-runner'
import type { RunStore } from '../store/store-runs'
import type { PilotAgentLaunchOptions } from './agent-launch-hook'
import {
  backgroundWorkRuns,
  newestLiveRow,
  newestSessionRow,
  turnOver,
  type AgentRow
} from './agent-rows'
import { runtimeClaims, runtimeSessionTabs, terminalOpen } from './session-tabs'
import {
  type AgentStepDeps,
  type AgentStepRequest,
  type DraftJudge,
  PromptNotSentError,
  type KnownTerminal,
  type SessionTerminals,
  type SessionTerminalState
} from './agent-step'
import { terminalLaunchOptions, type SessionPlan } from './step-launch-plan'
import { runtimeWorkspaceDeps, type WorkspaceDeps } from './workspace'
import { defaultUsagePaths, findSessionTranscript } from '../usage/step-usage'

export type LauncherDeps = AgentStepDeps & {
  workspace: WorkspaceDeps
  // Shell steps (Task 10). Without it, a shell first step can't start.
  startShellStep?: (req: AgentStepRequest) => Promise<LaunchResult>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
  // An env run's variables (pilotcli's data.env); Pilot's own step env wins over them.
  runEnv?: Record<string, string>
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
    session,
    runEnv: req.runEnv
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

// The runtime launcher's own mode reader: a step that names a mode fails instead of running without it.
// Pilot's services replace it with the skill's mode file (run/modes.ts modeTextFor).
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
// The runtime's own word for an agent that can't take a prompt now (RuntimeTerminalAgentStatusState). Its `working`
// is also a turn over's hook row (agent-rows turnOver), which can take one.
function agentBusy(status: string | null, rows: readonly AgentRow[]): boolean {
  if (status === 'working') {
    const row = newestLiveRow(rows)
    return row === null || !turnOver(row)
  }
  return status === 'permission'
}
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

// Claude's greyed prompt suggestion reads as a draft, so a draft is someone's only if input reached the
// process after its last turn began. With no record, only a process this app spawned is known untyped.
async function typedSince(
  runtime: OrcaRuntimeService,
  handle: string,
  turnStartedAt: number | undefined
): Promise<boolean> {
  if (turnStartedAt === undefined) {
    return true
  }
  const { ptyId, incarnationId } = await runtime.showTerminal(handle)
  if (!ptyId) {
    return true
  }
  const facts = runtime.terminalRunFacts
  const lastInputAt = facts.readLastInputAt(ptyId)
  if (lastInputAt === null) {
    return !facts.read(ptyId, incarnationId).freshSpawn
  }
  return lastInputAt > turnStartedAt
}

// H10's look at a session's old terminal (agent-step.ts checks the store first). The draft is read
// from the rendered screen (B6); anything unreadable is busy, never gone.
async function sessionTerminalState(
  runtime: OrcaRuntimeService,
  worktrees: LauncherWorktrees,
  { handle, paneKey }: KnownTerminal,
  sessionId: string,
  pause: Pause,
  judge: DraftJudge = {}
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
    if (
      agentBusy(agent.status, runtime.getAgentStatusRowsForPane(paneKey)) ||
      worktrees.paneState(paneKey) !== 'idle'
    ) {
      return 'busy'
    }
    if (
      (await worktrees.terminalDraft(handle)).trim() !== '' &&
      (await typedSince(runtime, handle, judge.turnStartedAt))
    ) {
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
  const rows =
    agent.status === 'working'
      ? await terminalPaneRows(runtime, handle).catch((error: unknown) => {
          throw new PromptNotSentError(`terminal ${handle} could not be read: ${messageOf(error)}`)
        })
      : []
  if (!agent.isRunningAgent || agentBusy(agent.status, rows)) {
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

// The hook rows of the pane a terminal sits in, under its live key and the one it was recorded under.
async function terminalPaneRows(runtime: OrcaRuntimeService, handle: string): Promise<AgentRow[]> {
  const t = await runtime.showTerminal(handle)
  const keys = new Set([
    `${t.tabId}:${t.leafId}`,
    ...(t.recordedPaneKey ? [t.recordedPaneKey] : [])
  ])
  return [...keys].flatMap((key) => runtime.getAgentStatusRowsForPane(key))
}

// A turn over still runs its background work in the tab, which closing would end: the session's tab is refused.
async function closeIdleSessionTerminal(
  runtime: OrcaRuntimeService,
  handle: string
): Promise<void> {
  if (backgroundWorkRuns(await terminalPaneRows(runtime, handle))) {
    throw new Error(`Couldn't close terminal ${handle}: its agent's background work still runs`)
  }
  await closeSessionTerminal(runtime, handle)
}

// Pilot's own idle tab, or a throwaway's before env delete (main/envs/service.ts). A process the close couldn't stop
// would make the resume a second one.
export async function closeSessionTerminal(
  runtime: OrcaRuntimeService,
  handle: string
): Promise<void> {
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
  const state: SessionTerminals['state'] = (terminal, id, judge) =>
    sessionTerminalState(runtime, worktrees, terminal, id, pause, judge)
  return {
    state,
    tabs: runtimeSessionTabs(runtime),
    draft: (handle) => worktrees.terminalDraft(handle),
    isOpen: (handle) => terminalOpen(runtime, handle),
    claims: runtimeClaims(runtime, state),
    send: (handle, prompt) => sendToIdleAgent(runtime, handle, prompt),
    close: (handle) => closeIdleSessionTerminal(runtime, handle)
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
    transcriptExists: async (agent, sessionId, hinted, startedAt) =>
      (await findSessionTranscript(agent, sessionId, hinted, startedAt, defaultUsagePaths())) !==
      null,
    sessionTerminals: runtimeSessionTerminals(runtime, worktrees, pause)
  }
}
