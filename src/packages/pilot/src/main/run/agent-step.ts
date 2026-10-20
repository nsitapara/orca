import type { ItemFields } from '../../shared/api-types'
import type { AgentKind, AutomationDefinition, StepDef } from '../../shared/definition/types'
import { UnrecordedLaunchError, type LaunchResult } from '../scheduler/tick-runner'
import type { PilotStore } from '../store/store'
import type { PilotAgentLaunchOptions } from './agent-launch-hook'
import {
  buildStepPrompt,
  continuePrompt,
  planSession,
  stepTitle,
  terminalLaunchOptions,
  type SessionPlan
} from './step-launch-plan'
import { isStartTimeout, type SessionClaimTable } from './session-claims'
import { sessionHome } from './session-home'
import { rememberWorktreeSession, worktreeSessionToResume } from './worktree-session'
import type { Workspace } from './workspace'
import { NothingToDoError } from './nothing-to-do'
import { blockUntrackedPreparation, claimPreparationWorker } from './preparation-worker'

export type AgentStepRequest = {
  runId: string
  definition: AutomationDefinition
  stepIdx: number
  itemKey: string
  label: string
  fields: ItemFields
  workspace: Workspace
  // A continued run's broken step: its own session to resume, and why it broke.
  resume?: { sessionId: string; reason: string }
}
export type KnownTerminal = { handle: string; paneKey: string | null }
// H10, the terminal a resumed session last ran in. free: an idle agent running that session, nobody
// typing; other: an idle agent running another session; busy: working, waiting, at a permission
// prompt, typed into, or unreadable; gone: closed, or its agent exited.
export type SessionTerminalState = 'free' | 'other' | 'busy' | 'gone'
// A send that typed nothing into the terminal (no idle agent, a draft, the runtime refused it). Any other
// failure of a send may have left the prompt with the agent.
export class PromptNotSentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PromptNotSentError'
  }
}
// When the agent's last turn began: a draft nothing was typed into since is the agent's own suggestion.
export type DraftJudge = { turnStartedAt?: number }
export type SessionTerminals = {
  state(
    terminal: KnownTerminal,
    sessionId: string,
    judge?: DraftJudge
  ): Promise<SessionTerminalState>
  // Every terminal Orca says holds the session, whether or not a step row names it (session-tabs.ts).
  tabs?(sessionId: string): Promise<KnownTerminal[]>
  // The terminal's unsent input, read right before closing a tab nobody of ours owns.
  draft?(handle: string): Promise<string>
  // Whether a terminal is still connected (a claim's recorded start).
  isOpen?(handle: string): Promise<boolean>
  // Who is about to start a process on a session (session-claims.ts); shared by launcher, Resume, answers.
  claims?: SessionClaimTable
  // Types the prompt in; refuses (PromptNotSentError) unless an idle agent is still in the foreground.
  send(handle: string, prompt: string): Promise<void>
  close(handle: string): Promise<void>
}
export type AgentStepDeps = {
  launchTerminal(
    selector: string,
    opts: PilotAgentLaunchOptions
  ): Promise<{ handle: string; paneKey?: string | null }>
  // The step's mode text, read in the step's workspace (Task 10c's readMode); null when it has no mode.
  modeText(step: StepDef, workspacePath: string): Promise<string | null>
  newSessionId(): string
  now(): number
  // Whether a session's transcript is on disk (usage's finders); a per_worktree session without one is
  // never resumed.
  transcriptExists(
    agent: AgentKind,
    sessionId: string,
    hinted: string | null,
    startedAt: number
  ): Promise<boolean>
  // Optional: without it a session's old terminal can't be looked at, so it resumes in a new one.
  sessionTerminals?: SessionTerminals
}
type Terminal = { handle: string; paneKey?: string | null }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Best effort: the failure being reported matters more than a second failure while recording it.
function failStep(store: PilotStore, runId: string, idx: number, error: string, at: number): void {
  try {
    store.runs.updateStep(runId, idx, { status: 'failed', error, finishedAt: at })
  } catch {}
}

function stopStep(store: PilotStore, runId: string, idx: number, reason: string, at: number): void {
  try {
    store.runs.updateStep(runId, idx, { status: 'stopped', error: reason, finishedAt: at })
  } catch {}
}

function launchOptions(
  req: AgentStepRequest,
  agent: AgentKind,
  session: SessionPlan,
  modeText: string | null
): PilotAgentLaunchOptions {
  const { definition, stepIdx, runId } = req
  const step = definition.steps[stepIdx]
  const { label, fields } = req
  const prompt = req.resume
    ? continuePrompt(step.name, req.resume.reason)
    : buildStepPrompt({ definition, step, runId, label, fields, modeText })
  return terminalLaunchOptions({
    agent,
    prompt,
    title: stepTitle(definition, step, label),
    env: {
      runId,
      automationId: definition.id,
      itemKey: req.itemKey,
      stepName: step.name,
      stepIdx,
      powers: definition.powers
    },
    args: step.args,
    session,
    runEnv: req.workspace.env
  })
}

// B8: Task 9b's startRun (and the tests' makeLauncher) write the row as `pending` before the workspace exists; take it
// over. Otherwise the row is created here, as M1 did.
function openStepRow(
  store: PilotStore,
  req: AgentStepRequest,
  agent: AgentKind,
  sessionId: string | null,
  at: number
): void {
  const { definition, stepIdx: idx, runId } = req
  const step = definition.steps[idx]
  const sessionPinned = sessionId !== null
  if (store.runs.steps(runId).find((s) => s.idx === idx)?.status === 'pending') {
    const known = sessionId !== null ? { sessionId } : {}
    store.runs.updateStep(runId, idx, {
      status: 'starting',
      startedAt: at,
      ...known,
      sessionPinned
    })
    return
  }
  store.runs.createStep({
    runId,
    idx,
    name: step.name,
    agent,
    skill: step.skill,
    startedAt: at,
    kind: 'agent',
    mode: step.mode,
    sessionId,
    sessionPinned,
    whenExpr: step.when
  })
}

// As M1: the terminal exists but no row may track it, so say which one and that it started.
function recordRunning(
  store: PilotStore,
  runId: string,
  idx: number,
  terminal: Terminal,
  launchArgs: string[],
  now: () => number
): LaunchResult {
  try {
    const { paneKey } = terminal
    if (!paneKey) {
      throw new Error('the runtime returned no pane to watch')
    }
    const recorded = store.runs.updateStartingStep(runId, idx, {
      status: 'running',
      terminalHandle: terminal.handle,
      paneKey,
      launchArgs
    })
    // The stale-start sweep closed this step during a slow launch: never bring it back to life.
    if (!recorded) {
      throw new Error('the run was closed before its agent started')
    }
    return { terminalHandle: terminal.handle, paneKey }
  } catch (error) {
    const message = `terminal ${terminal.handle} started but couldn't be recorded: ${messageOf(error)}`
    console.error(`pilot: ${message}`)
    failStep(store, runId, idx, message, now())
    throw new UnrecordedLaunchError(terminal.handle, message)
  }
}

// Starts one agent step of a run in its workspace (spec §7). The step row, with its pinned or
// resumed session id, exists before the agent does. A session to continue that isn't there fails the
// step: it never starts a fresh, unpinned session instead.
export async function launchAgentStep(
  store: PilotStore,
  req: AgentStepRequest,
  deps: AgentStepDeps
): Promise<LaunchResult> {
  const { definition, stepIdx: idx, runId } = req
  const step = definition.steps[idx]
  if (step.agent === 'shell') {
    throw new Error(`Step "${step.name}" is a shell step, not an agent step`)
  }
  const agent: AgentKind = step.agent
  const worktreeSession =
    step.session.kind === 'per_worktree'
      ? await worktreeSessionToResume(store, req, agent, deps)
      : null
  const priorSteps = store.runs.steps(runId)
  const newId = deps.newSessionId
  const session: SessionPlan = req.resume
    ? { kind: 'resume', sessionId: req.resume.sessionId }
    : planSession({ step, agent, priorSteps, worktreeSession, newId })
  const sessionId = session.kind === 'missing' ? null : session.sessionId
  openStepRow(store, req, agent, sessionId, deps.now())
  if (session.kind === 'missing') {
    failStep(store, runId, idx, session.reason, deps.now())
    throw new Error(session.reason)
  }
  let terminal: Terminal
  let launchArgs = [...step.args]
  // One process per session: taken before any look, so a Resume or launch overlapping this one finds it held.
  const claims = deps.sessionTerminals?.claims
  const by = `launch:${runId}:${idx}`
  let launching = false
  try {
    if (session.kind === 'resume' && claims) {
      await claims.expireIfSeen(session.sessionId)
      const claim = claims.acquire(session.sessionId, by)
      if (!claim.ok) {
        const closed =
          claim.handle && deps.sessionTerminals?.isOpen
            ? !(await deps.sessionTerminals.isOpen(claim.handle).catch(() => true))
            : false
        if (closed) {
          throw new Error(
            `A previous start of session ${session.sessionId} didn't come up; try again`
          )
        }
        throw new Error(`Session ${session.sessionId} is busy: another caller is opening it`)
      }
    }
    const modeText = await deps.modeText(step, req.workspace.path)
    // A typed variable, not a literal: `pilot` is beyond launchAgentTerminal's declared options.
    const opts: PilotAgentLaunchOptions = launchOptions(req, agent, session, modeText)
    const home =
      session.kind === 'resume' ? await sessionHome(store, req, session.sessionId, deps) : null
    claimPreparationWorker(store, req, deps.now())
    if (home && deps.sessionTerminals) {
      // A failure here fails the step: a second process on the same session would be worse.
      await deps.sessionTerminals.send(home.handle, opts.prompt)
      // The step runs under the args that process was launched with.
      ;({ launchArgs } = home)
      terminal = home
      // No new process was started: nothing for the claim to guard.
      if (session.kind === 'resume') {
        claims?.release(session.sessionId, by)
      }
    } else {
      launching = true
      terminal = await deps.launchTerminal(req.workspace.selector, opts)
      // The claim stays until this terminal's first status row is seen, or its TTL.
      if (session.kind === 'resume') {
        claims?.setHandle(session.sessionId, by, terminal.handle)
      }
    }
  } catch (error) {
    // A launch that timed out may still produce its tab: the claim stays (until landed, dead or the TTL).
    if (session.kind === 'resume' && !(launching && isStartTimeout(error))) {
      claims?.release(session.sessionId, by)
    }
    if (error instanceof NothingToDoError) {
      stopStep(store, runId, idx, error.message, deps.now())
      throw error
    }
    const message = messageOf(error)
    const reason = message === 'selector_not_found' ? 'worktree is gone' : message
    failStep(store, runId, idx, reason, deps.now())
    throw new Error(reason)
  }
  rememberWorktreeSession(store, req, agent, sessionId, deps.now())
  try {
    return recordRunning(store, runId, idx, terminal, launchArgs, deps.now)
  } catch (error) {
    if (error instanceof UnrecordedLaunchError) {
      blockUntrackedPreparation(store, req, error.message, deps.now())
    }
    throw error
  }
}
