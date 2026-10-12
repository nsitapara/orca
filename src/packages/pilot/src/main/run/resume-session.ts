import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { getAgentResumeArgv } from '../../../../../shared/agent-resume-argv'
import type { RunRow, SessionResumeResult, StepRow } from '../../shared/api-types'
import { isSessionId } from '../../shared/session-id'
import type { WorktreeFactDeps } from '../fields/worktree-facts'
import type { PilotStore } from '../store/store'
import { runtimeSessionTerminals } from './launch'
import { isStartTimeout, type SessionClaimTable } from './session-claims'
import { findLiveTab, terminalOpen, type SessionLook } from './session-tabs'

export type ResumeDeps = SessionLook & {
  // Who is about to start a process on a session; absent where nothing shares one.
  claims?: SessionClaimTable
  // A Pilot step is starting on this session with no terminal recorded yet (the launcher's window).
  startingOn(sessionId: string): boolean
  // Whether a terminal is still connected.
  isOpen(handle: string): Promise<boolean>
  run(runId: string): RunRow | null
  steps(runId: string): StepRow[]
  focus(handle: string): Promise<void>
  open(selector: string, command: string, title: string): Promise<{ handle: string }>
}

const RESUMABLE: Record<string, 'claude' | 'codex'> = { claude: 'claude', codex: 'codex' }

export function resumeCommand(agent: string, sessionId: string): string | null {
  const kind = RESUMABLE[agent]
  // A session id (shared/session-id.ts) only: anything else never reaches a shell command line.
  if (!kind || !isSessionId(sessionId)) {
    return null
  }
  return getAgentResumeArgv(kind, { key: 'session_id', id: sessionId })?.join(' ') ?? null
}

let resumeCalls = 0
const DEAD_START = "A previous start of this session didn't come up; try again"
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
  const sessionId = step.sessionId
  // Claim first, then look (as the launcher does): a look before the claim can predate another caller's
  // new row and then open a second tab. One holder per call: two Resumes must not share a claim.
  const claims = deps.claims
  const by = `resume:${++resumeCalls}`
  if (claims) {
    await claims.expireIfSeen(sessionId)
    const claim = claims.acquire(sessionId, by)
    if (!claim.ok) {
      return refuseOrFocus(deps, sessionId, hints, claim.handle)
    }
  }
  let opening = false
  try {
    // A launcher's step is starting on the session with no terminal recorded yet.
    if (deps.startingOn(sessionId)) {
      throw new Error(OPENING)
    }
    const live = await findLiveTab(deps, sessionId, hints)
    if (live) {
      claims?.release(sessionId, by)
      await deps.focus(live.handle)
      return { action: 'focused', handle: live.handle }
    }
    if (!run.worktreePath) {
      throw new Error(`Run ${run.id} has no worktree to resume in`)
    }
    opening = true
    const opened = await deps.open(
      `path:${run.worktreePath}`,
      command,
      `Resume · ${run.itemLabel} · ${step.name}`
    )
    claims?.setHandle(sessionId, by, opened.handle)
    return { action: 'opened', handle: opened.handle }
  } catch (error) {
    // An open that timed out may still produce its tab: the claim stays (until landed, dead or the TTL).
    if (!(opening && isStartTimeout(error))) {
      claims?.release(sessionId, by)
    }
    throw error
  }
}

// Another caller's claim holds the session: its tab when it is known and still open; else any live tab
// (a pure focus, nothing started); else wait. A closed start's tab is never focused.
async function refuseOrFocus(
  deps: ResumeDeps,
  sessionId: string,
  hints: { handle: string; paneKey: string | null }[],
  handle: string | null
): Promise<SessionResumeResult> {
  if (handle) {
    if (!(await deps.isOpen(handle).catch(() => true))) {
      throw new Error(DEAD_START)
    }
    await deps.focus(handle)
    return { action: 'focused', handle }
  }
  const live = await findLiveTab(deps, sessionId, hints)
  if (live) {
    await deps.focus(live.handle)
    return { action: 'focused', handle: live.handle }
  }
  throw new Error(OPENING)
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
    isOpen: (handle) => terminalOpen(runtime, handle),
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
