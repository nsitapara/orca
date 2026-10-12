import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { getAgentResumeArgv } from '../../../../../shared/agent-resume-argv'
import type { RunRow, SessionResumeResult, StepRow } from '../../shared/api-types'
import type { WorktreeFactDeps } from '../fields/worktree-facts'
import type { PilotStore } from '../store/store'
import type { KnownTerminal, SessionTerminalState } from './agent-step'
import { runtimeSessionTerminals } from './launch'

export type ResumeDeps = {
  run(runId: string): RunRow | null
  steps(runId: string): StepRow[]
  // The launcher's own look at a session's terminal (launch.ts sessionTerminalState): free, busy, other or gone.
  state(terminal: KnownTerminal, sessionId: string): Promise<SessionTerminalState>
  focus(handle: string): Promise<void>
  open(selector: string, command: string, title: string): Promise<{ handle: string }>
}

const RESUMABLE: Record<string, 'claude' | 'codex'> = { claude: 'claude', codex: 'codex' }
// Session ids are uuids or rollout ids; anything else never reaches a shell command line.
const SAFE_ID = /^[A-Za-z0-9._-]+$/

export function resumeCommand(agent: string, sessionId: string): string | null {
  const kind = RESUMABLE[agent]
  if (!kind || !SAFE_ID.test(sessionId)) {
    return null
  }
  return getAgentResumeArgv(kind, { key: 'session_id', id: sessionId })?.join(' ') ?? null
}

// A throwing look counts as busy: never a second process on a session that might be in use.
async function lookAt(
  deps: ResumeDeps,
  terminal: KnownTerminal,
  sessionId: string
): Promise<SessionTerminalState> {
  try {
    return await deps.state(terminal, sessionId)
  } catch {
    return 'busy'
  }
}

// The tab this session is live in: the step's own, then the later steps of the run that continued it.
// Live is anything but gone or running another session (H10: one process per agent session).
async function liveTab(
  deps: ResumeDeps,
  step: StepRow,
  sessionId: string,
  all: StepRow[]
): Promise<string | null> {
  const seen = new Set<string>()
  const sameSession = all.filter((s) => s.sessionId === sessionId && s.terminalHandle)
  for (const s of [step, ...sameSession.toReversed()]) {
    if (!s.terminalHandle || seen.has(s.terminalHandle)) {
      continue
    }
    seen.add(s.terminalHandle)
    const state = await lookAt(deps, { handle: s.terminalHandle, paneKey: s.paneKey }, sessionId)
    if (state === 'free' || state === 'busy') {
      return s.terminalHandle
    }
  }
  return null
}

// The session's tab when it is still live; else its session reopened in a new tab in the run's
// worktree. Opening only creates a terminal: it writes no step row (so no launchArgs to record).
export async function resumeStepSession(
  deps: ResumeDeps,
  req: { runId: string; stepIdx: number }
): Promise<SessionResumeResult> {
  const run = deps.run(req.runId)
  const all = deps.steps(req.runId)
  const step = all.find((s) => s.idx === req.stepIdx)
  if (!run || !step) {
    throw new Error(`No step ${req.stepIdx} in run ${req.runId}`)
  }
  const command = step.sessionId ? resumeCommand(step.agent, step.sessionId) : null
  if (!step.sessionId || !command) {
    throw new Error('This step has no agent session to resume')
  }
  const live = await liveTab(deps, step, step.sessionId, all)
  if (live) {
    await deps.focus(live)
    return { action: 'focused', handle: live }
  }
  if (!run.worktreePath) {
    throw new Error(`Run ${run.id} has no worktree to resume in`)
  }
  const opened = await deps.open(
    `path:${run.worktreePath}`,
    command,
    `Resume · ${run.itemLabel} · ${step.name}`
  )
  return { action: 'opened', handle: opened.handle }
}

export function runtimeResumeDeps(
  runtime: OrcaRuntimeService,
  store: PilotStore,
  worktrees: Pick<
    WorktreeFactDeps,
    'listWorktrees' | 'terminalAlive' | 'paneState' | 'terminalDraft'
  >
): ResumeDeps {
  const terminals = runtimeSessionTerminals(runtime, worktrees)
  return {
    run: (id) => store.runs.get(id),
    steps: (id) => store.runs.steps(id),
    state: (terminal, sessionId) => terminals.state(terminal, sessionId),
    focus: async (handle) => {
      await runtime.focusTerminal(handle)
    },
    open: async (selector, command, title) => {
      const terminal = await runtime.createTerminal(selector, { command, title, focus: true })
      return { handle: terminal.handle }
    }
  }
}
