import type { ItemDecision, TickResult, Verdict } from '../../shared/api-types'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PeopleDirectory } from '../../shared/people'
import { decideTick, usesHandled } from '../../shared/tick/decide'
import { createPassFetchCache, type PassFetchCache } from '../sources/fetch-cache'
import type { GlabApi } from '../sources/gitlab-api'
import type { PilotStore } from '../store/store'
import { gatherItems, type ItemDeps } from './tick-items'

export type { TickResult }
export type LaunchRequest = {
  runId: string
  definition: AutomationDefinition
  decision: ItemDecision
}
export type LaunchResult = { terminalHandle: string; paneKey: string }
// The launcher started a terminal but no step records it: the agent runs, untracked.
export class UnrecordedLaunchError extends Error {
  constructor(
    readonly terminalHandle: string,
    message: string
  ) {
    super(message)
    this.name = 'UnrecordedLaunchError'
  }
}
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// `pass` is the scheduler pass's fetch cache, shared by every automation that ticks in that pass.
// A tick without one (Run now, a dry run) gets its own.
export type TickOptions = { dryRun: boolean; pass?: PassFetchCache }

export type TickDeps = ItemDeps & {
  store: PilotStore
  gitlab(repoPath: string): Promise<GlabApi>
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

const ACTED_ON_WHERE = new Set(['state', 'author', 'head_pipeline'])

// Keys a later task implements. Until then a file using one fails the tick instead of running wider.
function unactedKey(def: AutomationDefinition): string | null {
  const items = def.items
  if (items && items.match.length > 0) {
    return "items.match isn't supported yet"
  }
  if (def.start === 'ask_first') {
    return "start: ask_first isn't supported yet"
  }
  // A run-once automation's own workspace is the main checkout (its item is the repo).
  const own = items === null ? 'main_checkout' : 'item_worktree'
  if (def.workspace.kind !== own) {
    return `workspace: ${def.workspace.kind} isn't supported yet`
  }
  const clause = Object.keys(items?.where ?? {}).find((k) => !ACTED_ON_WHERE.has(k))
  if (clause) {
    return `items.where.${clause} isn't supported yet`
  }
  return null
}

async function decide(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: TickDeps,
  pass: PassFetchCache,
  tickId: number
): Promise<ItemDecision[]> {
  const unsupported = unactedKey(def)
  if (unsupported) {
    throw new Error(unsupported)
  }
  const { items, scope } = await gatherItems(def, people, deps, pass, tickId)
  const { store } = deps
  return decideTick({
    definition: def,
    items,
    scope,
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
    // A run-once automation without once_per keeps no key: it runs on every tick.
    if (usesHandled(def)) {
      deps.store.markHandled(def.id, decision.onceKey, runId, at)
    }
    try {
      unlaunched.current = null
      await deps.launch({ runId, definition: def, decision })
    } catch (error) {
      const run = { runId, onceKey: decision.onceKey }
      if (error instanceof UnrecordedLaunchError) {
        keepOrphanHandled(def, run, error.message, deps)
      } else {
        releaseUnlaunched(def, run, errorMessage(error), deps)
      }
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

// The agent is running in a terminal no step tracks, so its key stays handled (marked again, in case
// the stale-start sweep freed it during a slow launch) and no later tick starts a second agent on the
// item. The run is failed, and its outcome names the terminal.
function keepOrphanHandled(
  def: AutomationDefinition,
  u: Unlaunched,
  message: string,
  deps: TickDeps
): void {
  const at = deps.now()
  try {
    deps.store.runs.update(u.runId, { status: 'failed', outcome: message, finishedAt: at })
  } catch {}
  if (!usesHandled(def)) {
    return
  }
  try {
    deps.store.markHandled(def.id, u.onceKey, u.runId, at)
  } catch {}
}

// Seen and baselined keys belong to automations with items; a run-once tick writes neither.
function markDecisions(def: AutomationDefinition, decisions: ItemDecision[], deps: TickDeps): void {
  if (def.items === null) {
    return
  }
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
  opts: TickOptions
): Promise<TickResult> {
  const tickId = deps.store.startTick(def.id, opts.dryRun, deps.now())
  const pass = opts.pass ?? createPassFetchCache(`tick-${tickId}`, deps.gitlab)
  let decisions: ItemDecision[]
  try {
    decisions = await decide(def, people, deps, pass, tickId)
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
