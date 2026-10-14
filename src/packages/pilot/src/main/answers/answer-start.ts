import { existsSync } from 'node:fs'
import { checkoutRemoved, homeOf } from '../../shared/api-types-env'
import { homedir } from 'node:os'
import { PromptNotSentError } from '../run/agent-step'
import type { AgentSessionMode } from '../run/launch'
import { UnrecordedLaunchError } from '../scheduler/tick-runner'
import type { AgentKind } from '../../shared/definition/types'
import type { AgentDispatch, AgentDispatchDeps, AgentGroup, AnswerRun } from './answer-run'
import { hold } from './holds'
import {
  answersLine,
  modeFile,
  newSessionPrompt,
  withModePointer,
  type CarriedCards
} from './prompt'
import { DraftInProgressError } from './session-probe'
import { answersModeOf, type SessionTarget } from './sessions'

const TYPING = 'someone is typing in the tab that asked'

type Started = { handle: string; paneKey: string | null; sessionId: string | null; args: string[] }

export function agentOf(target: SessionTarget): AgentKind {
  return target.kind === 'new' ? target.agent : target.asking.agent
}

// What the answers step records: who runs it, and in which skill and mode (none when the asking session goes on).
export function answersStepOf(target: SessionTarget): {
  agent: AgentKind
  skill: string | null
  mode: string | null
} {
  if (target.kind === 'new') {
    return { agent: target.agent, skill: target.skill, mode: target.mode }
  }
  return { agent: target.asking.agent, skill: target.asking.skill, mode: null }
}

export function askingRunOf(group: AgentGroup, target: SessionTarget): string | null {
  return target.kind === 'new' ? group.answers[0].item.runId : target.asking.runId
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A fresh session (sessions.ts, answer-env.ts) gets what the cards said, and whether the asking run's checkout is gone.
function carriedCards(
  deps: AgentDispatchDeps,
  target: SessionTarget,
  group: AgentGroup
): CarriedCards | null {
  if (target.kind !== 'new' || !target.fresh) {
    return null
  }
  const askingId = askingRunOf(group, target)
  const asking = askingId ? deps.store.runs.get(askingId) : null
  return {
    removed: asking !== null && checkoutRemoved(asking),
    cards: group.answers.map((a) => ({ id: a.item.id, context: a.item.context }))
  }
}

type Mode = { skill: string | null; mode: string }
const NO_MODE: Mode = { skill: null, mode: 'answers' }

// The answers mode this route tells the agent to follow: only when the automation configures one
// (an `answers:` block) and its file is on disk. Else the plain answers line, as before modes existed.
function answersMode(deps: AgentDispatchDeps, group: AgentGroup, target: SessionTarget): Mode {
  if (!group.def.answers) {
    return NO_MODE
  }
  const mode = target.kind === 'new' ? target : answersModeOf(group.def, target.asking)
  if (!mode.skill) {
    return NO_MODE
  }
  const file = modeFile(mode.skill, mode.mode)
  const onDisk = deps.fileExists ?? existsSync
  if (onDisk(file.replace(/^~/, homedir()))) {
    return { skill: mode.skill, mode: mode.mode }
  }
  const warn = deps.warn ?? ((m: string) => console.warn(m))
  warn(`${group.def.id}: answers mode file ${file} is missing; sending the answers without it`)
  return NO_MODE
}

// The asking tab (its own process, under the args it was launched with), or a new terminal opened
// with no args of its own: a fork of the asking session, or a new answers session.
async function start(
  deps: AgentDispatchDeps,
  group: AgentGroup,
  target: SessionTarget,
  run: AnswerRun,
  path: string
): Promise<Started> {
  const line = answersLine(askingRunOf(group, target), run.id, group.answers)
  const mode = answersMode(deps, group, target)
  if (target.kind === 'resume') {
    await deps.send(target.handle, withModePointer(mode, line))
    return askingTab(target)
  }
  const prompt =
    target.kind === 'new'
      ? newSessionPrompt(group.def, run, mode, line, carriedCards(deps, target, group))
      : withModePointer(mode, line)
  const session: AgentSessionMode =
    target.kind === 'fork' ? { kind: 'fork', sessionId: target.sessionId } : { kind: 'new' }
  const args: string[] = []
  const opened = await deps.open({
    runId: run.id,
    stepIdx: 0,
    stepName: 'answers',
    automationId: group.def.id,
    itemKey: run.itemKey,
    powers: group.def.powers,
    worktree: { id: null, path },
    agent: agentOf(target),
    prompt,
    title: `${group.def.name} · answers`,
    args,
    session,
    // An env answer run's variables (M4 §8, every step of a run gets them); none for any other.
    runEnv: deps.store.runs.get(run.id)?.env?.vars
  })
  return {
    handle: opened.terminalHandle,
    paneKey: opened.paneKey,
    sessionId: opened.sessionId,
    args
  }
}

function askingTab(target: Extract<SessionTarget, { kind: 'resume' }>): Started {
  const { sessionId, launchArgs } = target.asking
  return { handle: target.handle, paneKey: target.paneKey, sessionId, args: launchArgs ?? [] }
}

// Every caller of openAgentTerminal records the terminal and its launch args on its step (Task 8d).
// False when the step was closed meanwhile (the stale-start sweep during a slow launch).
function recordRunning(deps: AgentDispatchDeps, runId: string, started: Started): boolean {
  return deps.store.runs.updateStartingStep(runId, 0, {
    status: 'running',
    terminalHandle: started.handle,
    launchArgs: started.args,
    ...(started.paneKey ? { paneKey: started.paneKey } : {}),
    ...(started.sessionId ? { sessionId: started.sessionId, sessionPinned: true } : {})
  })
}

function closeRun(
  deps: AgentDispatchDeps,
  runId: string,
  status: 'failed' | 'cancelled',
  outcome: string
): void {
  const at = deps.now()
  const step = status === 'failed' ? 'failed' : 'skipped'
  deps.store.runs.updateStep(runId, 0, { status: step, error: outcome, finishedAt: at })
  deps.store.runs.update(runId, { status, outcome, finishedAt: at })
}

function event(
  deps: AgentDispatchDeps,
  run: AnswerRun,
  group: AgentGroup,
  kind: string,
  error: string
) {
  const stored = deps.store.runs.get(run.id)
  const path = (stored ? homeOf(stored) : null) ?? group.worktreePath
  deps.store.events.add({
    at: deps.now(),
    automationId: group.def.id,
    runId: run.id,
    worktreePath: path,
    itemKey: run.itemKey,
    kind,
    payload: { error }
  })
}

// The answers went to an agent nothing here can follow: the run fails, and the dispatcher hands the
// cards back to their person instead of ever sending them again on its own.
function unfollowed(
  deps: AgentDispatchDeps,
  group: AgentGroup,
  run: AnswerRun,
  detail: string
): AgentDispatch {
  closeRun(deps, run.id, 'failed', `Started, but Pilot can't follow it: ${detail}`)
  event(deps, run, group, 'answer_unfollowed', detail)
  return { kind: 'unfollowed', runId: run.id, detail }
}

// Why a start failed decides what follows. Nothing typed (a draft, no idle agent, a launch that never
// made a terminal): the run closes and the answers are tried again. Typed into the asking tab with no
// turn seen: the run keeps going on that terminal, so the engine's watch (and onRunEnd) decides, and it
// holds the worktree meanwhile. Started where nothing can follow: unfollowed. Never a second send.
function startFailed(
  deps: AgentDispatchDeps,
  group: AgentGroup,
  target: SessionTarget,
  run: AnswerRun,
  error: unknown
): AgentDispatch {
  const message = messageOf(error)
  if (error instanceof DraftInProgressError) {
    closeRun(deps, run.id, 'cancelled', `Not sent: ${TYPING}`)
    return { kind: 'held', hold: hold('typing', TYPING) }
  }
  if (error instanceof UnrecordedLaunchError) {
    return unfollowed(deps, group, run, `terminal ${error.terminalHandle}: ${message}`)
  }
  if (target.kind === 'resume' && !(error instanceof PromptNotSentError)) {
    const tab = askingTab(target)
    if (!recordRunning(deps, run.id, tab)) {
      return unfollowed(deps, group, run, `terminal ${tab.handle}: ${message}`)
    }
    event(deps, run, group, 'answer_send_unconfirmed', message)
    return { kind: 'dispatched', runId: run.id, route: 'resume', sessionId: tab.sessionId }
  }
  closeRun(deps, run.id, 'failed', `Couldn't start: ${message}`)
  return { kind: 'held', hold: hold('retry', message) }
}

export async function launchAnswerRun(
  deps: AgentDispatchDeps,
  group: AgentGroup,
  target: SessionTarget,
  run: AnswerRun,
  path: string
): Promise<AgentDispatch> {
  let started: Started
  try {
    started = await start(deps, group, target, run, path)
  } catch (error) {
    return startFailed(deps, group, target, run, error)
  }
  if (!recordRunning(deps, run.id, started)) {
    const detail = `terminal ${started.handle}: the answer run was closed before its agent started`
    return unfollowed(deps, group, run, detail)
  }
  return { kind: 'dispatched', runId: run.id, route: target.kind, sessionId: started.sessionId }
}
