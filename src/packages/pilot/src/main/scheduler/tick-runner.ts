import type { ItemDecision, TickResult, Verdict } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PeopleDirectory } from '../../shared/people'
import { authorInScope, decideTick } from '../../shared/tick/decide'
import { addQuotaFields, type QuotaReader } from '../fields/quota'
import { addWorktreeFields, type FactDeps } from '../fields/worktree-fields'
import type { GlabApi } from '../sources/gitlab-api'
import { listMergeRequestItems } from '../sources/merge-requests'
import type { PilotStore } from '../store/store'

export type { TickResult }
export type LaunchRequest = {
  runId: string
  definition: AutomationDefinition
  decision: ItemDecision
}
export type LaunchResult = { terminalHandle: string; paneKey: string }
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// `quota` should be the cached reader in production; a throw is still fail-open (nulls).
export type TickDeps = {
  store: PilotStore
  now(): number
  resolveRepo(repo: string): Promise<{ id: string; path: string }>
  gitlab(repoPath: string): Promise<GlabApi>
  facts: FactDeps
  quota: QuotaReader
  launch(req: LaunchRequest): Promise<LaunchResult>
}

const pad = (v: number) => String(v).padStart(2, '0')

// Run ids are global in the runs table. Two ticks of one automation in the same minute (a manual
// "run now" beside the schedule) would collide on `<id>-<minute>-<n>`, so the tick id is part of it.
export function makeRunId(automationId: string, at: number, n: number, tickId: number): string {
  const d = new Date(at)
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  return `${automationId}-${stamp}-t${tickId}-${n}`
}

function countVerdicts(decisions: ItemDecision[]): Partial<Record<Verdict, number>> {
  const counts: Partial<Record<Verdict, number>> = {}
  for (const d of decisions) {
    counts[d.verdict] = (counts[d.verdict] ?? 0) + 1
  }
  return counts
}

async function decide(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: TickDeps
): Promise<ItemDecision[]> {
  const repo = await deps.resolveRepo(def.repo)
  const api = await deps.gitlab(repo.path)
  const inScope = (username: string) => authorInScope(def, people, username)
  let items = await listMergeRequestItems(api, inScope)
  items = await addWorktreeFields(
    items,
    def.id,
    repo.path,
    deps.facts,
    (i) => i.fields['mr.pipeline'] !== null
  )
  items = addQuotaFields(items, await deps.quota().catch(() => ({ weekly: null, session: null })))
  const { store } = deps
  return decideTick({
    definition: def,
    people,
    items,
    handledKeys: store.handledKeys(def.id),
    seenKeys: store.seenKeys(def.id),
    runningCount: store.runs.runningCount(def.id)
  })
}

// A launch failure keeps the decision's verdict 'started'; the RUN row is the record of the failure.
async function startRuns(
  def: AutomationDefinition,
  decisions: ItemDecision[],
  tickId: number,
  deps: TickDeps,
  runIds: Map<string, string>,
  unlaunched: { current: Unlaunched | null }
): Promise<void> {
  const at = deps.now()
  let n = 0
  for (const decision of decisions) {
    if (decision.verdict !== 'started') {
      continue
    }
    n += 1
    const runId = makeRunId(def.id, at, n, tickId)
    const worktreePath = decision.fields['worktree.path']
    deps.store.runs.create({
      id: runId,
      automationId: def.id,
      tickId,
      itemKey: decision.key,
      itemLabel: decision.label,
      worktreePath: typeof worktreePath === 'string' ? worktreePath : null,
      startedAt: at
    })
    runIds.set(decision.key, runId)
    unlaunched.current = { runId, onceKey: decision.onceKey }
    deps.store.markHandled(def.id, decision.onceKey, runId, at)
    try {
      unlaunched.current = null
      await deps.launch({ runId, definition: def, decision })
    } catch (error) {
      releaseUnlaunched(def, { runId, onceKey: decision.onceKey }, errorMessage(error), deps)
    }
  }
}

type Unlaunched = { runId: string; onceKey: string }

// Best effort: one failing cleanup call must not mask the others.
function releaseUnlaunched(
  def: AutomationDefinition,
  u: Unlaunched,
  message: string,
  deps: TickDeps
) {
  const outcome = `Couldn't start: ${message}`
  try {
    deps.store.runs.update(u.runId, { status: 'failed', outcome, finishedAt: deps.now() })
  } catch {}
  try {
    deps.store.unmarkHandled(def.id, u.onceKey)
  } catch {}
}

function markDecisions(def: AutomationDefinition, decisions: ItemDecision[], deps: TickDeps): void {
  const at = deps.now()
  for (const d of decisions) {
    if (d.verdict === 'out_of_scope') {
      continue
    }
    deps.store.markSeen(def.id, d.key, at)
    if (d.verdict === 'baselined') {
      deps.store.markHandled(def.id, d.onceKey, null, at)
    }
  }
}

// finishTick can itself throw (store down); runTick must still resolve with the failed result.
function finishFailed(
  tickId: number,
  message: string,
  counts: Partial<Record<Verdict, number>>,
  deps: TickDeps
): void {
  try {
    deps.store.finishTick(tickId, 'failed', message, counts, deps.now())
  } catch (error) {
    console.error(`pilot: couldn't finish tick ${tickId}: ${errorMessage(error)}`)
  }
}

export async function runTick(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: TickDeps,
  opts: { dryRun: boolean }
): Promise<TickResult> {
  const tickId = deps.store.startTick(def.id, opts.dryRun, deps.now())
  let decisions: ItemDecision[]
  try {
    decisions = await decide(def, people, deps)
  } catch (error) {
    const message = errorMessage(error)
    finishFailed(tickId, message, {}, deps)
    return { tickId, status: 'failed', error: message, decisions: [] }
  }
  const runIds = new Map<string, string>()
  const unlaunched: { current: Unlaunched | null } = { current: null }
  try {
    if (!opts.dryRun) {
      markDecisions(def, decisions, deps)
      await startRuns(def, decisions, tickId, deps, runIds, unlaunched)
    }
    deps.store.recordDecisions(tickId, decisions, runIds)
    deps.store.finishTick(tickId, 'ok', null, countVerdicts(decisions), deps.now())
    return { tickId, status: 'ok', error: null, decisions }
  } catch (error) {
    const message = errorMessage(error)
    if (unlaunched.current) {
      releaseUnlaunched(def, unlaunched.current, message, deps)
    }
    finishFailed(tickId, message, countVerdicts(decisions), deps)
    return { tickId, status: 'failed', error: message, decisions }
  }
}
