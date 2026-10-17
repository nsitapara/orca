import type { RunRow } from '../../shared/api-types'
import type {
  AnswersDef,
  AutomationDefinition,
  EnvWorkspaceDef
} from '../../shared/definition/types'
import type { RunEnd } from '../../shared/run/step-plan'
import type { EnvPreparer } from '../envs/prepare'
import { worktreePathKey } from '../fields/agent-activity'
import { fieldsForRun } from '../inbox/run-fields'
import { envHooks } from '../run/advance-env'
import { runFieldsOf } from '../run/advance-fields'
import type { CloseOptions } from '../run/run-close'
import type { PilotStore } from '../store/store'
import { answersStepOf, askingRunOf, launchAnswerRun } from './answer-start'
import type { AgentDispatch, AgentDispatchDeps, AgentGroup, AnswerRun } from './answer-run'
import { holdRows } from './dispatch-groups'
import { hold, type Hold } from './holds'
import { newSession, type SessionTarget } from './sessions'

// One per dispatcher: makes envs, closes an answer run like any run (closeRun: its answers hook, then its env's
// teardown), and hands answers that reached an agent Pilot can't follow back to their person.
export type AnswerEnvHooks = {
  preparer: EnvPreparer
  close(run: RunRow, end: RunEnd, opts?: CloseOptions): void
  handBack(itemIds: string[], why: string): void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// The job's env for an answer run (M4 §8, "An approved fix"), always with writes. A worktree subject names the card's
// worktree. Otherwise, when the asking run worked in place or kept, its folder; else the job's own subject. create may
// answer any mode for any subject (Contract answers 3), an existing branch included, so nothing else is decided here.
export function answerEnvOf(
  def: Pick<AutomationDefinition, 'name' | 'workspace'> & {
    answers?: Pick<AnswersDef, 'stack'> | null
  },
  home: string | null,
  asking: { homePath: string | null; mode: string | null } | null
): EnvWorkspaceDef {
  const env = answerEnvFolder(def, home, asking)
  // answers: { stack: never } keeps the job's env rules but starts no stack.
  return def.answers?.stack === 'never' ? { ...env, stack: 'never' } : env
}

function answerEnvFolder(
  def: Pick<AutomationDefinition, 'name' | 'workspace'>,
  home: string | null,
  asking: { homePath: string | null; mode: string | null } | null
): EnvWorkspaceDef {
  const ws = def.workspace
  if (ws.kind !== 'env') {
    throw new Error(`${def.name} has no env workspace`)
  }
  if (ws.subject.kind === 'worktree' && home) {
    return { ...ws, writes: true, subject: { kind: 'worktree', worktree: home, at: null } }
  }
  const stayed = asking?.mode === 'in_place' || asking?.mode === 'kept'
  if (stayed && asking?.homePath) {
    return {
      ...ws,
      writes: true,
      subject: { kind: 'worktree', worktree: asking.homePath, at: null }
    }
  }
  return { ...ws, writes: true }
}

// The rows this answer run was sent go back to the queue, as the dispatcher holds any (dispatch-groups.ts holdRows).
function requeue(store: PilotStore, runId: string, held: Hold, at: number): void {
  const entries = store.queue.forRun(runId).flatMap((row) => {
    const item = row.state === 'dispatched' ? store.inbox.get(row.inboxItemId) : null
    return item ? [{ row, item }] : []
  })
  holdRows(store, entries, held, at)
}

// The route once the folder is known. The asking session lives under its own run's folder (its transcript too): in that
// very folder the chosen route stands; anywhere else (a throwaway, another worktree) the answers go to a fresh session,
// which gets what the cards said. Decided by the folder, never by the mode (Contract answers 3).
function routeIn(
  store: PilotStore,
  run: RunRow,
  target: SessionTarget,
  def: AutomationDefinition
): SessionTarget {
  if (target.kind === 'new') {
    return target
  }
  const here = run.worktreePath
  const there = store.runs.get(target.asking.runId)?.worktreePath ?? null
  if (here !== null && there !== null && worktreePathKey(here) === worktreePathKey(there)) {
    return target
  }
  return { ...newSession(def, target.asking), fresh: 'elsewhere' }
}

// What became of the launch, for the rows marked sent: the route it took, or back to the queue, or back to their person.
// A launch that didn't go closed its run itself (answer-start.ts); its env's teardown then comes with the next poll.
function settleLaunch(
  deps: AgentDispatchDeps,
  envs: AnswerEnvHooks,
  group: AgentGroup,
  run: AnswerRun,
  sent: AgentDispatch
): void {
  const at = deps.now()
  if (sent.kind === 'dispatched') {
    for (const row of deps.store.queue.forRun(run.id)) {
      deps.store.queue.update(row.id, { route: sent.route, targetSessionId: sent.sessionId }, at)
    }
  } else if (sent.kind === 'held') {
    requeue(deps.store, run.id, sent.hold, at)
  } else if (sent.kind === 'unfollowed') {
    envs.handBack(
      group.answers.map((a) => a.item.id),
      sent.detail
    )
  }
}

// The answer run exists (running, step 0 pending, the 15-min claim taken, no worktree claimed: Ruling P10). Its env is
// prepared off the dispatcher's pass once its rows read sent (afterSent), then the answers launch in its folder. The env
// phase is the engine's own (envHooks): an env that never came, or a launch that throws, holds the rows again, closes the
// run and settles its pending step 0.
export function prepareAnswerRun(
  deps: AgentDispatchDeps,
  envs: AnswerEnvHooks,
  group: AgentGroup,
  target: SessionTarget,
  run: AnswerRun,
  home: string
): AgentDispatch {
  const stored = (): RunRow => {
    const row = deps.store.runs.get(run.id)
    if (!row) {
      throw new Error(`Answer run ${run.id} is gone`)
    }
    return row
  }
  const walk = async (): Promise<void> => {
    const ready = stored()
    const route = routeIn(deps.store, ready, target, group.def)
    deps.store.runs.updateStep(run.id, 0, { status: 'starting', ...answersStepOf(route) })
    const sent = await launchAnswerRun(deps, group, route, run, ready.worktreePath ?? home)
    settleLaunch(deps, envs, group, run, sent)
  }
  const close = (closing: RunRow, end: RunEnd, opts?: CloseOptions): void => {
    // Deferred (not_yet): nothing ran, so no try is counted. Anything else is a failed try.
    const held =
      end.status === 'cancelled' ? hold('waits', end.outcome) : hold('retry', end.outcome)
    requeue(deps.store, run.id, held, deps.now())
    envs.close(closing, end, opts)
  }
  const hooks = envHooks(deps, { walk, locked: (_runId, work) => work(), close }, run.id)
  const afterSent = (): void => {
    try {
      const askingId = askingRunOf(group, target)
      const asking = askingId ? deps.store.runs.get(askingId) : null
      const facts = asking
        ? { homePath: asking.homePath ?? null, mode: asking.env?.mode ?? null }
        : null
      const fields = {
        ...fieldsForRun(deps.store, run.id),
        'worktree.path': home,
        ...runFieldsOf(stored(), group.def)
      }
      const env = answerEnvOf(group.def, home, facts)
      envs.preparer.begin(
        { run: stored(), env, repo: group.def.repo, label: run.label, fields },
        hooks
      )
    } catch (error) {
      hooks.end({ status: 'failed', outcome: messageOf(error) }, {})
    }
  }
  return { kind: 'dispatched', runId: run.id, route: target.kind, sessionId: null, afterSent }
}
