import type { ItemDecision, TickResult, TickTrigger, Verdict } from '../../shared/api-types'
import { repend } from '../handover/repend'
import { expireStale, handoverOf, settleFed } from '../handover/tick-handover'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { PeopleDirectory } from '../../shared/people'
import { usesHandled, workspacePathOf } from '../../shared/tick/decide'
import type { Admission, RunCapacity } from '../capacity/run-capacity'
import { askDecisions, type AskDeps } from '../run/ask-first'
import type { PassFetchCache } from '../sources/fetch-cache'
import type { GlabApi } from '../sources/gitlab-api'
import { worktreeTakenSinceDecide, type DecideDeps, type FedOutcome } from './tick-decide'
import { decide, dryRunTick } from './tick-dry-run'

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
  // Asks first: the card an `asked` decision leaves, and the run it holds (Task 25).
  ask: AskDeps
  // A dry run of an env automation: where each started item would work (main/envs/preview.ts).
  previewEnvs?(def: AutomationDefinition, decisions: ItemDecision[]): Promise<void>
  // The run limit across automations: a started item past it waits in the queue instead (verdict queued).
  capacity?: Pick<RunCapacity, 'admit' | 'settle' | 'forget'>
}
// `pass` is the scheduler pass's fetch cache, shared by every automation that ticks in that pass. `trigger`: the run
// whose feed (run: now) asked for this tick, recorded on it for Activity. `byHand`: a Run now, whose runs are stored
// with trigger `manual`.
export type TickOptions = {
  dryRun: boolean
  pass?: PassFetchCache
  trigger?: TickTrigger
  byHand?: boolean
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

// Only 'started' decisions start runs; 'asked' ones wait for an answer (askDecisions writes the card).
// A launch failure keeps the decision's verdict 'started'; the RUN row is the record of the failure.
async function startRuns(
  def: AutomationDefinition,
  decisions: ItemDecision[],
  tickId: number,
  deps: TickDeps,
  runIds: Map<string, string>,
  unlaunched: { current: Unlaunched | null },
  byHand: boolean
): Promise<void> {
  const at = deps.now()
  let n = 0
  for (const decision of decisions) {
    if (decision.verdict !== 'started') {
      continue
    }
    if (
      def.items?.kind === 'inbox_preparation' &&
      !deps.store.inboxPreparations
        .listEligible(deps.now())
        .some(
          (item) =>
            item.id === decision.key &&
            item.preparation?.revision === decision.fields['preparation.revision']
        )
    ) {
      decision.verdict = 'notdue'
      decision.reason = 'Context request was answered, claimed, or closed before launch'
      continue
    }
    const worktreePath = recordedWorktree(def, decision.fields)
    const busy = worktreeTakenSinceDecide(deps.store, def, worktreePath, decision.fields)
    if (busy !== null) {
      decision.verdict = 'skipped'
      decision.reason = `Another run is active in ${busy}`
      continue
    }
    const admission: Admission = deps.capacity?.admit(def, decision, byHand) ?? {
      start: true,
      byHand
    }
    if (!admission.start) {
      decision.verdict = 'queued'
      decision.reason = admission.reason
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
      startedAt: at,
      ...(admission.byHand ? { trigger: 'manual' as const } : {})
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
    repend(deps.store, u.runId)
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
    repend(deps.store, u.runId)
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
  deps: TickDeps,
  warnings: readonly string[] = []
): void {
  try {
    deps.store.finishTick(tickId, 'failed', message, counts, deps.now(), warnings)
  } catch (error) {
    console.error(`pilot: couldn't finish tick ${tickId}: ${errorMessage(error)}`)
  }
}

// A real tick always has its row's id; only a dry run's is null.
export async function runTick(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: TickDeps,
  opts: TickOptions & { dryRun: false }
): Promise<TickResult & { tickId: number }>
export async function runTick(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: TickDeps,
  opts: TickOptions
): Promise<TickResult>
export async function runTick(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: TickDeps,
  opts: TickOptions
): Promise<TickResult> {
  if (opts.dryRun) {
    return dryRunTick(def, people, deps, opts)
  }
  const tickId = deps.store.startTick(def.id, deps.now())
  let decisions: ItemDecision[]
  let warnings: string[]
  let feeding: FedOutcome
  try {
    if (opts.trigger) {
      deps.store.handovers.setTickTrigger(tickId, opts.trigger)
    }
    expireStale(deps.store, def, tickId, deps.now())
    const outcome = await decide(def, people, deps, opts, tickId)
    decisions = outcome.decisions
    warnings = outcome.warnings
    feeding = outcome
  } catch (error) {
    const message = errorMessage(error)
    finishFailed(tickId, message, {}, deps)
    // Its queued items leave the line, so a job whose ticks keep failing can't hold the slot they wait for.
    try {
      deps.capacity?.forget(def.id)
    } catch {}
    return { tickId, status: 'failed', error: message, decisions: [], warnings: [] }
  }
  for (const warning of warnings) {
    console.warn(`[pilot] ${def.id}: ${warning}`)
  }
  const runIds = new Map<string, string>()
  const unlaunched: { current: Unlaunched | null } = { current: null }
  try {
    markDecisions(def, decisions, deps)
    const at = deps.now()
    askDecisions(deps.ask, def, decisions, runIds, {
      tickId,
      runIdFor: (n) => `${makeRunId(def.id, at, n, tickId)}-ask`
    })
    await startRuns(def, decisions, tickId, deps, runIds, unlaunched, opts.byHand === true)
    deps.capacity?.settle(def, decisions)
    deps.store.recordDecisions(tickId, decisions, runIds)
    settleFed(deps.store, def, feeding, decisions, runIds, tickId, deps.now())
    deps.store.finishTick(tickId, 'ok', null, countVerdicts(decisions), deps.now(), warnings)
    const handover = handoverOf(def, feeding.fed, decisions)
    return {
      tickId,
      status: 'ok',
      error: null,
      decisions,
      warnings,
      ...(handover ? { handover } : {})
    }
  } catch (error) {
    const message = errorMessage(error)
    if (unlaunched.current) {
      releaseUnlaunched(def, unlaunched.current, message, deps)
    }
    finishFailed(tickId, message, countVerdicts(decisions), deps, warnings)
    return { tickId, status: 'failed', error: message, decisions, warnings }
  }
}
