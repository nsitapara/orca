import type { ItemFields } from '../../shared/api-types'
import type { AgentKind, AutomationDefinition, StepDef } from '../../shared/definition/types'
import { SESSION_LOOKBACK_MS } from '../fields/runtime-facts'
import { UnrecordedLaunchError, type LaunchResult } from '../scheduler/tick-runner'
import type { PilotStore } from '../store/store'
import type { PilotAgentLaunchOptions } from './agent-launch-hook'
import {
  buildStepPrompt,
  planSession,
  stepTitle,
  terminalLaunchOptions,
  type SessionPlan
} from './step-launch-plan'
import type { Workspace } from './workspace'

export type AgentStepRequest = {
  runId: string
  definition: AutomationDefinition
  stepIdx: number
  itemKey: string
  label: string
  fields: ItemFields
  workspace: Workspace
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
  // H10, both optional (without them a resumed session always opens a new terminal): resumeTarget is true
  // when the terminal is live, its agent idle and its draft empty; sendPrompt types the prompt into it.
  resumeTarget?(handle: string, paneKey: string | null): Promise<boolean>
  sendPrompt?(handle: string, prompt: string): Promise<void>
}
type Terminal = { handle: string; paneKey?: string | null }
type KnownTerminal = { handle: string; paneKey: string | null }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// Best effort: the failure being reported matters more than a second failure while recording it.
function failStep(store: PilotStore, runId: string, idx: number, error: string, at: number): void {
  try {
    store.runs.updateStep(runId, idx, { status: 'failed', error, finishedAt: at })
  } catch {}
}

function knownSessionId(session: SessionPlan): string | null {
  if (session.kind === 'missing') {
    return null
  }
  return session.sessionId
}

// per_worktree: the next run of this automation in this worktree resumes this session (§9 agent_sessions).
function rememberWorktreeSession(
  store: PilotStore,
  req: AgentStepRequest,
  agent: AgentKind,
  sessionId: string | null,
  at: number
): void {
  const step = req.definition.steps[req.stepIdx]
  if (step.session.kind !== 'per_worktree' || sessionId === null) {
    return
  }
  try {
    store.sessions.set(req.definition.id, req.workspace.path, agent, sessionId, at)
  } catch (error) {
    console.error(
      `pilot: couldn't remember the session for ${req.workspace.path}: ${messageOf(error)}`
    )
  }
}

function launchOptions(
  req: AgentStepRequest,
  agent: AgentKind,
  session: SessionPlan,
  modeText: string | null
): PilotAgentLaunchOptions {
  const { definition, stepIdx, runId } = req
  const step = definition.steps[stepIdx]
  return terminalLaunchOptions({
    agent,
    prompt: buildStepPrompt({
      definition,
      step,
      runId,
      label: req.label,
      fields: req.fields,
      modeText
    }),
    title: stepTitle(definition, step, req.label),
    env: {
      runId,
      automationId: definition.id,
      itemKey: req.itemKey,
      stepName: step.name,
      stepIdx,
      powers: definition.powers
    },
    args: step.args,
    session
  })
}

// B8: Task 9b's startRun (and makeLauncher) write the row as `pending` before the workspace exists; take it
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
  const existing = store.runs.steps(runId).find((s) => s.idx === idx)
  if (existing?.status === 'pending') {
    store.runs.updateStep(runId, idx, {
      status: 'starting',
      startedAt: at,
      ...(sessionId !== null ? { sessionId } : {}),
      sessionPinned: sessionId !== null
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
    sessionPinned: sessionId !== null,
    whenExpr: step.when
  })
}

// H10: the terminal the session to resume last ran in: the continued step's, or the newest step of this
// automation in this worktree that ran the stored per-worktree session.
function sessionTerminal(
  store: PilotStore,
  req: AgentStepRequest,
  session: SessionPlan,
  now: number
): KnownTerminal | null {
  if (session.kind !== 'resume') {
    return null
  }
  const policy = req.definition.steps[req.stepIdx].session
  let found: { terminalHandle: string | null; paneKey: string | null } | undefined
  if (policy.kind === 'continue') {
    found = store.runs.steps(req.runId).find((s) => s.name === policy.step)
  } else if (policy.kind === 'per_worktree') {
    found = store.runs
      .sessionStepsIn(req.definition.id, req.workspace.path, now - SESSION_LOOKBACK_MS)
      .findLast((s) => s.sessionId === session.sessionId && s.terminalHandle !== null)
  }
  return found?.terminalHandle ? { handle: found.terminalHandle, paneKey: found.paneKey } : null
}

// The session's old terminal, when it is free to take the prompt; null means "open a new terminal".
async function freeTerminal(
  store: PilotStore,
  req: AgentStepRequest,
  session: SessionPlan,
  deps: AgentStepDeps
): Promise<KnownTerminal | null> {
  if (!deps.resumeTarget || !deps.sendPrompt) {
    return null
  }
  const old = sessionTerminal(store, req, session, deps.now())
  if (!old) {
    return null
  }
  try {
    return (await deps.resumeTarget(old.handle, old.paneKey)) ? old : null
  } catch {
    return null
  }
}

// As M1: the terminal exists but no row may track it, so say which one and that it started.
function recordRunning(
  store: PilotStore,
  runId: string,
  idx: number,
  terminal: Terminal,
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
      paneKey
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
      ? (store.sessions.get(definition.id, req.workspace.path, agent)?.sessionId ?? null)
      : null
  const session = planSession({
    step,
    agent,
    priorSteps: store.runs.steps(runId),
    worktreeSession,
    newId: deps.newSessionId
  })
  const sessionId = knownSessionId(session)
  openStepRow(store, req, agent, sessionId, deps.now())
  if (session.kind === 'missing') {
    failStep(store, runId, idx, session.reason, deps.now())
    throw new Error(session.reason)
  }
  let terminal: Terminal
  try {
    const modeText = await deps.modeText(step, req.workspace.path)
    // A typed variable, not a literal: `pilot` is beyond launchAgentTerminal's declared options.
    const opts: PilotAgentLaunchOptions = launchOptions(req, agent, session, modeText)
    const free = await freeTerminal(store, req, session, deps)
    if (free && deps.sendPrompt) {
      // A failure here fails the step: a second process on the same session would be worse.
      await deps.sendPrompt(free.handle, opts.prompt)
      terminal = free
    } else {
      terminal = await deps.launchTerminal(req.workspace.selector, opts)
    }
  } catch (error) {
    const message = messageOf(error)
    const reason = message === 'selector_not_found' ? 'worktree is gone' : message
    failStep(store, runId, idx, reason, deps.now())
    throw new Error(reason)
  }
  rememberWorktreeSession(store, req, agent, sessionId, deps.now())
  return recordRunning(store, runId, idx, terminal, deps.now)
}
