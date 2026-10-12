import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { getAgentResumeArgv } from '../../../../../shared/agent-resume-argv'
import type { RunRow, SessionResumeResult, StepRow } from '../../shared/api-types'
import type { WorktreeFactDeps } from '../fields/worktree-facts'
import type { PilotStore } from '../store/store'
import { runtimeSessionTerminals } from './launch'
import type { SessionClaimTable } from './session-claims'
import { findLiveTab, type SessionLook } from './session-tabs'

export type ResumeDeps = SessionLook & {
  // Who is about to start a process on a session; absent where nothing shares one.
  claims?: SessionClaimTable
  // A Pilot step is starting on this session with no terminal recorded yet (the launcher's window).
  startingOn(sessionId: string): boolean
  run(runId: string): RunRow | null
  steps(runId: string): StepRow[]
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

let resumeCalls = 0
const OPENING = 'Session is opening… try again in a moment'

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
  // Any run's, any tab: the step's own, the run's later steps of this session, then every terminal Orca
  // says holds it (a tab Resume opened before, another run's per_worktree session, one opened by hand).
  const hints = [step, ...all.filter((s) => s.sessionId === step.sessionId).toReversed()]
    .filter((s) => s.terminalHandle)
    .map((s) => ({ handle: s.terminalHandle as string, paneKey: s.paneKey }))
  const live = await findLiveTab(deps, step.sessionId, hints)
  if (live) {
    await deps.focus(live.handle)
    return { action: 'focused', handle: live.handle }
  }
  // Nothing shows the session yet, but a start may be under way: a launcher's starting step, or another
  // caller's claim (a double click, an overlapping Resume). Focus its tab when known, else wait.
  if (deps.startingOn(step.sessionId)) {
    throw new Error(OPENING)
  }
  const claims = deps.claims
  // One holder per call: two Resumes of the same session must not share a claim.
  const by = `resume:${++resumeCalls}`
  if (claims) {
    await claims.expireIfSeen(step.sessionId)
    const claim = claims.acquire(step.sessionId, by)
    if (!claim.ok) {
      if (claim.handle) {
        await deps.focus(claim.handle)
        return { action: 'focused', handle: claim.handle }
      }
      throw new Error(OPENING)
    }
  }
  try {
    if (!run.worktreePath) {
      throw new Error(`Run ${run.id} has no worktree to resume in`)
    }
    const opened = await deps.open(
      `path:${run.worktreePath}`,
      command,
      `Resume · ${run.itemLabel} · ${step.name}`
    )
    claims?.setHandle(step.sessionId, by, opened.handle)
    return { action: 'opened', handle: opened.handle }
  } catch (error) {
    claims?.release(step.sessionId, by)
    throw error
  }
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
    tabs: terminals.tabs,
    claims: terminals.claims,
    startingOn: (id) =>
      store.runs.runningSteps().some((s) => s.sessionId === id && s.terminalHandle === null),
    stepOn: (handle) => store.runs.runningSteps().some((s) => s.terminalHandle === handle),
    focus: async (handle) => {
      await runtime.focusTerminal(handle)
    },
    open: async (selector, command, title) => {
      const terminal = await runtime.createTerminal(selector, { command, title, focus: true })
      return { handle: terminal.handle }
    }
  }
}
