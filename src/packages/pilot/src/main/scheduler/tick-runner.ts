import type { ItemDecision, TickResult, Verdict } from '../../shared/api-types'
import type { AutomationDefinition, ItemKind } from '../../shared/definition/types'
import type { PeopleDirectory } from '../../shared/people'
import { usesHandled, workspacePathOf } from '../../shared/tick/decide'
import { createPassFetchCache, type PassFetchCache } from '../sources/fetch-cache'
import { glabApiForRepo, type GlabApi } from '../sources/gitlab-api'
import {
  decideTickItems,
  worktreeTakenSinceDecide,
  type DecideDeps,
  type DecideOutcome
} from './tick-decide'

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

// Items, fields and decisions come from decideTickItems; launch starts a run's first step. `gitlab` only
// feeds the pass a tick run by hand (Run now, a dry run) makes for itself; it defaults to the real client.
export type TickDeps = DecideDeps & {
  gitlab?(repoPath: string): Promise<GlabApi>
  // The run engine's startRun: it starts the run's first steps; the tick only needs it to settle or throw.
  launch(req: LaunchRequest): Promise<unknown>
}
// `pass` is the scheduler pass's fetch cache, shared by every automation that ticks in that pass.
export type TickOptions = { dryRun: boolean; pass?: PassFetchCache }

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

// The where keys each kind's source acts on: merge_request's since Task 14c; the other kinds' keys
// land with their sources (Tasks 15–17).
const ACTED_ON_WHERE: Partial<Record<ItemKind, ReadonlySet<string>>> = {
  merge_request: new Set([
    'state',
    'author',
    'reviewer',
    'head_pipeline',
    'draft',
    'approved_by',
    'target_branch'
  ]),
  pipeline: new Set(['ref', 'status', 'select', 'source', 'marker_jobs']),
  worktree: new Set(['has_mr', 'mr_author', 'mr_state', 'branch_owner', 'commits']),
  linear_ticket: new Set(['assignee', 'state_type', 'team', 'has_branch'])
}

// Keys a later task implements (Task 2b ruling): until then a file using one fails the tick instead
// of running wider. start: ask_first → Task 25. Every workspace launches (Task 8d).
function unactedKey(def: AutomationDefinition): string | null {
  if (def.start === 'ask_first') {
    return "start: ask_first isn't supported yet"
  }
  if (!def.items) {
    return null
  }
  const acted = ACTED_ON_WHERE[def.items.kind]
  const clause = Object.keys(def.items.where).find((k) => !acted?.has(k))
  if (clause) {
    return `items.where.${clause} isn't supported yet`
  }
  return null
}

// Seen keys (first_seen, oldest_waiting_first) belong to automations with items; a run-once tick
// writes none. Its once_per key is kept only when it sets one (usesHandled): else every tick runs it.
function remembersSeen(def: AutomationDefinition): boolean {
  return def.items !== null
}

type Unlaunched = { runId: string; onceKey: string }

// Where the run is recorded: the item's worktree, or the repo's main checkout for main_checkout
// (recorded, though G2 keeps it out of the one-agent-per-worktree rule); null for a new worktree,
// which the launcher's claim records on this run once it exists (run/workspace.ts).
function recordedWorktree(
  def: AutomationDefinition,
  fields: ItemDecision['fields']
): string | null {
  if (def.workspace.kind === 'main_checkout') {
    const path = fields['repo.path']
    return typeof path === 'string' && path !== '' ? path : null
  }
  return workspacePathOf(def, fields)
}

// Only 'started' decisions start runs; 'asked' ones wait for an answer (Task 25 writes the card).
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
    const worktreePath = recordedWorktree(def, decision.fields)
    const busy = worktreeTakenSinceDecide(deps.store, def, worktreePath, decision.fields)
    if (busy !== null) {
      decision.verdict = 'skipped'
      decision.reason = `Another run is active in ${busy}`
      continue
    }
    n += 1
    const runId = makeRunId(def.id, at, n, tickId)
    deps.store.runs.create({
      id: runId,
      automationId: def.id,
      tickId,
      itemKey: decision.key,
      itemLabel: decision.label,
      worktreePath,
      startedAt: at
    })
    runIds.set(decision.key, runId)
    unlaunched.current = { runId, onceKey: decision.onceKey }
    // Marked 'started' at launch (re-marking a failed key starts it fresh); Task 9 settles it.
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
  if (!usesHandled(def)) {
    return
  }
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

function markDecisions(def: AutomationDefinition, decisions: ItemDecision[], deps: TickDeps): void {
  if (!remembersSeen(def)) {
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

async function decide(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: TickDeps,
  opts: TickOptions,
  tickId: number
): Promise<DecideOutcome> {
  const unsupported = unactedKey(def)
  if (unsupported) {
    throw new Error(unsupported)
  }
  const pass = opts.pass ?? createPassFetchCache(`tick-${tickId}`, deps.gitlab ?? glabApiForRepo)
  return decideTickItems(def, people, deps, pass, tickId)
}

export async function runTick(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: TickDeps,
  opts: TickOptions
): Promise<TickResult> {
  const tickId = deps.store.startTick(def.id, opts.dryRun, deps.now())
  let decisions: ItemDecision[]
  let warnings: string[]
  try {
    const outcome = await decide(def, people, deps, opts, tickId)
    decisions = outcome.decisions
    warnings = outcome.warnings
  } catch (error) {
    const message = errorMessage(error)
    finishFailed(tickId, message, {}, deps)
    return { tickId, status: 'failed', error: message, decisions: [], warnings: [] }
  }
  for (const warning of warnings) {
    console.warn(`[pilot] ${def.id}: ${warning}`)
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
    return { tickId, status: 'ok', error: null, decisions, warnings }
  } catch (error) {
    const message = errorMessage(error)
    if (unlaunched.current) {
      releaseUnlaunched(def, unlaunched.current, message, deps)
    }
    finishFailed(tickId, message, countVerdicts(decisions), deps)
    return { tickId, status: 'failed', error: message, decisions, warnings }
  }
}
