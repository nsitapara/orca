import type { AgentKind, AutomationDefinition } from '../../shared/definition/types'
import type { QuotaReading } from '../fields/quota'
import type { AgentSessionMode, AgentTerminalRequest, AgentTerminalResult } from '../run/launch'
import type { PilotStore } from '../store/store'
import { hold, quotaHold, type Hold } from './holds'
import { answersLine, answersText, newSessionPrompt, type AgentAnswer } from './prompt'
import { DraftInProgressError } from './session-probe'
import { chooseSession, type SessionProbe, type SessionTarget } from './sessions'

// gate.py CLAIM_MINUTES: one automation's answers session has the worktree to itself this long.
export const CLAIM_MS = 15 * 60_000
const TYPING = 'someone is typing in the tab that asked'

export type AgentDispatchDeps = {
  store: PilotStore
  now(): number
  probe: SessionProbe
  quota(agent: AgentKind): Promise<QuotaReading>
  // run/launch.ts openAgentTerminal.
  open(req: AgentTerminalRequest): Promise<AgentTerminalResult>
  // Types the answers into the asking session's own tab (answers/session-probe.ts sessionPromptSender).
  send(handle: string, prompt: string): Promise<void>
  mainCheckout(repo: string): Promise<string>
}
export type AgentGroup = {
  def: AutomationDefinition
  worktreePath: string | null
  rowId: number
  answers: AgentAnswer[]
}
export type AgentDispatch =
  | {
      kind: 'dispatched'
      runId: string
      route: 'resume' | 'fork' | 'new'
      sessionId: string | null
    }
  | { kind: 'held'; hold: Hold }
type AnswerRun = { id: string; label: string; itemKey: string }
type Started = { handle: string; paneKey: string | null; sessionId: string | null; args: string[] }

const pad = (n: number): string => String(n).padStart(2, '0')

function utcStamp(at: number): string {
  const d = new Date(at)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// A retried dispatch of the same queue row in the same minute gets its own run: <base>-2, <base>-3, …
function freshRunId(store: PilotStore, base: string): string {
  let id = base
  for (let n = 2; store.runs.get(id); n += 1) {
    id = `${base}-${n}`
  }
  return id
}

function liveAnswerRun(store: PilotStore, path: string, automationId: string): string | null {
  const runs = store.runs.runningInWorktree(path)
  return runs.find((r) => r.trigger === 'answer' && r.automationId === automationId)?.id ?? null
}

function agentOf(target: SessionTarget): AgentKind {
  return target.kind === 'new' ? target.agent : target.asking.agent
}

function askingRunOf(group: AgentGroup, target: SessionTarget): string | null {
  return target.kind === 'new' ? group.answers[0].item.runId : target.asking.runId
}

function createAnswerRun(
  deps: AgentDispatchDeps,
  group: AgentGroup,
  target: SessionTarget,
  path: string,
  at: number
): AnswerRun {
  const first = group.answers[0].item
  const parentRunId = askingRunOf(group, target)
  const parent = parentRunId ? deps.store.runs.get(parentRunId) : null
  const run: AnswerRun = {
    id: freshRunId(deps.store, `${group.def.id}-${utcStamp(at)}-answer-${group.rowId}`),
    label: parent?.itemLabel ?? first.title,
    itemKey: first.itemKey ?? parent?.itemKey ?? `repo:${group.def.repo}`
  }
  deps.store.runs.create({
    id: run.id,
    automationId: group.def.id,
    tickId: null,
    itemKey: run.itemKey,
    itemLabel: run.label,
    worktreePath: path,
    startedAt: at,
    trigger: 'answer',
    parentRunId
  })
  deps.store.runs.createStep({
    runId: run.id,
    idx: 0,
    name: 'answers',
    agent: agentOf(target),
    skill: target.kind === 'new' ? target.skill : target.asking.skill,
    startedAt: at,
    kind: 'agent',
    mode: target.kind === 'new' ? target.mode : null
  })
  // What {run.answer} is in this run (G7): Task 25's runAnswer reads it back.
  deps.store.events.add({
    at,
    automationId: group.def.id,
    runId: run.id,
    worktreePath: path,
    itemKey: run.itemKey,
    kind: 'answer_run',
    payload: { answer: answersText(group.answers), items: group.answers.map((a) => a.item.id) }
  })
  return run
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
  if (target.kind === 'resume') {
    await deps.send(target.handle, line)
    const { sessionId, launchArgs } = target.asking
    return { handle: target.handle, paneKey: target.paneKey, sessionId, args: launchArgs ?? [] }
  }
  const prompt = target.kind === 'new' ? newSessionPrompt(group.def, run, target, line) : line
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
    session
  })
  return {
    handle: opened.terminalHandle,
    paneKey: opened.paneKey,
    sessionId: opened.sessionId,
    args
  }
}

// Every caller of openAgentTerminal records the terminal and its launch args on its step (Task 8d).
function recordRunning(deps: AgentDispatchDeps, runId: string, started: Started): void {
  const recorded = deps.store.runs.updateStartingStep(runId, 0, {
    status: 'running',
    terminalHandle: started.handle,
    launchArgs: started.args,
    ...(started.paneKey ? { paneKey: started.paneKey } : {}),
    ...(started.sessionId ? { sessionId: started.sessionId, sessionPinned: true } : {})
  })
  if (!recorded) {
    throw new Error(`the answer run was closed before its agent started in ${started.handle}`)
  }
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

// apply.py start_agent, as an answer run of the asking run: held for a typing person, the quota or
// another automation's claim on the worktree; a launch that fails is a retry (the dispatcher counts them).
export async function dispatchToAgent(
  deps: AgentDispatchDeps,
  group: AgentGroup
): Promise<AgentDispatch> {
  const now = deps.now()
  const items = group.answers.map((a) => a.item)
  let target: SessionTarget | { kind: 'hold'; hold: Hold }
  try {
    target = await chooseSession(group.def, items, deps.store, deps.probe, now)
  } catch (error) {
    const words = `the asking tab could not be read: ${messageOf(error)}`
    return { kind: 'held', hold: hold('retry', words) }
  }
  if (target.kind === 'hold') {
    return { kind: 'held', hold: target.hold }
  }
  const quota = quotaHold(agentOf(target), await deps.quota(agentOf(target)))
  if (quota) {
    return { kind: 'held', hold: quota }
  }
  let path: string
  try {
    path = group.worktreePath ?? (await deps.mainCheckout(group.def.repo))
  } catch (error) {
    return { kind: 'held', hold: hold('retry', `no main checkout: ${messageOf(error)}`) }
  }
  // A worktree's own hold (runs working there) covers it; the main checkout is shared (G2), so job-wide
  // answers wait only for this automation's answer run still live there: never a second one beside it.
  const live = group.worktreePath === null ? liveAnswerRun(deps.store, path, group.def.id) : null
  if (live) {
    return {
      kind: 'held',
      hold: hold('worktree_busy', `answer run ${live} is still working there`)
    }
  }
  const claimKey = group.worktreePath ?? `${path}#${group.def.id}`
  if (!deps.store.queue.claim(claimKey, group.def.id, now + CLAIM_MS, now)) {
    return { kind: 'held', hold: hold('claimed', 'another automation is applying answers there') }
  }
  const run = createAnswerRun(deps, group, target, path, now)
  try {
    const started = await start(deps, group, target, run, path)
    recordRunning(deps, run.id, started)
    return { kind: 'dispatched', runId: run.id, route: target.kind, sessionId: started.sessionId }
  } catch (error) {
    if (error instanceof DraftInProgressError) {
      closeRun(deps, run.id, 'cancelled', `Not sent: ${TYPING}`)
      return { kind: 'held', hold: hold('typing', TYPING) }
    }
    closeRun(deps, run.id, 'failed', `Couldn't start: ${messageOf(error)}`)
    return { kind: 'held', hold: hold('retry', messageOf(error)) }
  }
}
