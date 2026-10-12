import type { InboxItemRow, QueueState } from '../../shared/api-types'
import type { AgentKind, AutomationDefinition } from '../../shared/definition/types'
import type { QuotaReading } from '../fields/quota'
import type { AgentTerminalRequest, AgentTerminalResult } from '../run/launch'
import type { PilotStore } from '../store/store'
import { agentOf, askingRunOf, launchAnswerRun } from './answer-start'
import { hold, quotaHold, type Hold } from './holds'
import { answersText, type AgentAnswer } from './prompt'
import { chooseSession, type SessionProbe, type SessionTarget } from './sessions'

// gate.py CLAIM_MINUTES: one automation's answers session has the worktree to itself this long.
export const CLAIM_MS = 15 * 60_000
// quota.py: a reading that fails is unknown, and unknown lets automations run.
const UNKNOWN_QUOTA: QuotaReading = { weekly: null, session: null }
const QUEUED: readonly QueueState[] = ['not_ready', 'ready', 'held']

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
  // The card as it is now if it still waits on this very answer, else null (currentAnswer): read right
  // before the answer run is written, after every await of the dispatch.
  current(item: InboxItemRow): InboxItemRow | null
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
  // Every card moved on while the dispatch awaited (ticked, cleared, answered again, retired).
  | { kind: 'nothing' }
  // The answers reached an agent Pilot can't follow: they are never sent again on their own.
  | { kind: 'unfollowed'; runId: string; detail: string }
export type AnswerRun = { id: string; label: string; itemKey: string }

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

// The card as it is now, if it still waits on this very answer: answered with the same answer, saved at
// the same moment, and still queued. A card ticked, cleared, answered again or retired since is null.
export function currentAnswer(store: PilotStore, item: InboxItemRow): InboxItemRow | null {
  const now = store.inbox.get(item.id)
  const was = item.answer
  if (!now?.answer || !was || now.status !== 'answered' || now.answeredAt !== item.answeredAt) {
    return null
  }
  if (now.answer.digest !== was.digest || now.answer.text !== was.text) {
    return null
  }
  return store.queue.forInboxItem(item.id).some((r) => QUEUED.includes(r.state)) ? now : null
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

// apply.py start_agent, as an answer run of the asking run: held for a typing person, the quota or
// another automation's claim on the worktree. Only the answers still waiting after every await go.
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
    // Unreadable is busy (24a): a hold, not a failed try.
    const words = `the asking tab could not be read: ${messageOf(error)}`
    return { kind: 'held', hold: hold('worktree_busy', words) }
  }
  if (target.kind === 'hold') {
    return { kind: 'held', hold: target.hold }
  }
  let reading = UNKNOWN_QUOTA
  try {
    reading = await deps.quota(agentOf(target))
  } catch {
    // As the quota check: a failed read is unknown.
  }
  const quota = quotaHold(agentOf(target), reading)
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
  // Nothing is awaited from here until the prompt is built from these answers.
  const answers = group.answers.flatMap((a) => {
    const item = deps.current(a.item)
    return item ? [{ ...a, item }] : []
  })
  if (answers.length === 0) {
    return { kind: 'nothing' }
  }
  const claimKey = group.worktreePath ?? `${path}#${group.def.id}`
  if (!deps.store.queue.claim(claimKey, group.def.id, now + CLAIM_MS, now)) {
    return { kind: 'held', hold: hold('claimed', 'another automation is applying answers there') }
  }
  const still = { ...group, answers }
  const run = createAnswerRun(deps, still, target, path, now)
  return launchAnswerRun(deps, still, target, run, path)
}
