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
// "run now" beside the schedule) would collide on `<id>-<minute>-<n>`, so the runner passes the
// tick id too. Without it the id is the plain `<id>-<minute>-<n>` form.
export function makeRunId(automationId: string, at: number, n: number, tickId?: number): string {
  const d = new Date(at)
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}`
  const tick = tickId === undefined ? '' : `-t${tickId}`
  return `${automationId}-${stamp}${tick}-${n}`
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
  items = addQuotaFields(items, await deps.quota())
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
  deps: TickDeps
): Promise<Map<string, string>> {
  const runIds = new Map<string, string>()
  const at = deps.now()
  let n = 0
  for (const decision of decisions) {
    if (decision.verdict !== 'started') {
      continue
    }
    n += 1
    const runId = makeRunId(def.id, at, n, tickId)
    runIds.set(decision.key, runId)
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
    deps.store.markHandled(def.id, decision.onceKey, runId, at)
    try {
      await deps.launch({ runId, definition: def, decision })
    } catch (error) {
      deps.store.runs.update(runId, {
        status: 'failed',
        outcome: `Couldn't start: ${(error as Error).message}`,
        finishedAt: deps.now()
      })
      deps.store.unmarkHandled(def.id, decision.onceKey)
    }
  }
  return runIds
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
    const message = (error as Error).message
    deps.store.finishTick(tickId, 'failed', message, {}, deps.now())
    return { tickId, status: 'failed', error: message, decisions: [] }
  }
  let runIds = new Map<string, string>()
  if (!opts.dryRun) {
    markDecisions(def, decisions, deps)
    runIds = await startRuns(def, decisions, tickId, deps)
  }
  deps.store.recordDecisions(tickId, decisions, runIds)
  deps.store.finishTick(tickId, 'ok', null, countVerdicts(decisions), deps.now())
  return { tickId, status: 'ok', error: null, decisions }
}
