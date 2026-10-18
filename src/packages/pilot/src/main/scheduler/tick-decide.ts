import type { HandledRow, ItemDecision } from '../../shared/api-types'
import type { AutomationDefinition, CheckDef } from '../../shared/definition/types'
import type { PeopleDirectory } from '../../shared/people'
import { evaluateCheck, type CheckResult } from '../../shared/tick/checks'
import {
  decideTick,
  preCheckGate,
  type DecideInput,
  type DecideItem,
  type HandledState,
  type ScopeGate
} from '../../shared/tick/decide'
import { runFields } from '../../shared/template'
import { engineChildEnv, type EngineEnv } from '../engine-env'
import { addActivityFacts, type ActivityRuntime } from '../fields/activity-facts'
import { worktreePathKey } from '../fields/agent-activity'
import { addBuiltinFields, addCustomFields, type FieldEngineDeps } from '../fields/engine'
import { resolveScriptCommand, type ScriptRunner } from '../fields/script-runner'
import { mapLimit } from '../map-limit'
import type { PassFetchCache } from '../sources/fetch-cache'
import type { IdsRunner } from '../sources/ids-from'
import { itemSource } from '../sources/registry'
import { runOnceItem } from '../sources/run-once'
import type { Item, RepoFacts, SourceContext, SourceListing } from '../sources/types'
import type { PilotStore } from '../store/store'
import { idsForTick, type FedOutcome } from './tick-ids'
import { lastLine } from '../last-line'

export type SourceAccess = {
  list(def: AutomationDefinition, ctx: SourceContext): Promise<SourceListing>
  scope(def: AutomationDefinition, item: Item, people: PeopleDirectory): ScopeGate | null
}

// Production sources: the kind's ItemSource, or the one synthetic item of a run-once automation.
export const registrySources: SourceAccess = {
  async list(def, ctx) {
    if (def.items === null) {
      return { items: [runOnceItem(ctx.repo)], warnings: [] }
    }
    return itemSource(def.items.kind).list(ctx, def.items.where)
  },
  scope(def, item, people) {
    if (def.items === null) {
      return null
    }
    const result = itemSource(def.items.kind).scope(item, def.items.where, people)
    if (result.ok) {
      return null
    }
    return { verdict: result.verdict, reason: result.reason }
  }
}

export type DecideDeps = {
  store: PilotStore
  now(): number
  resolveRepo(repo: string): Promise<RepoFacts>
  sources: SourceAccess
  fields: FieldEngineDeps
  // Terminal activity for a `worktree: idle` check (Task 19c). Absent: the pre-pass is skipped.
  activity?: ActivityRuntime
  // Runs where.ids_from's command; absent, the real process (runIdsCommand).
  runIds?: IdsRunner
}
export type { FedOutcome }
export type DecideOutcome = FedOutcome & { decisions: ItemDecision[]; warnings: string[] }
type ScriptCheck = Extract<CheckDef, { kind: 'script' }>

const SCRIPT_CHECK_CONCURRENCY = 4
const HELD: HandledState = { status: 'started', failedAt: null }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// retry_after_failure's input. Only a run settles a key (setHandledStatus), so a key no run holds
// (baselined, or brought in by the retired sweep-state import) reads as started whatever its row says: never
// retryable. The one exception is an old sweep's failure that import brought in with its time (04's failed.json): it
// is due again retry_after_failure after that failure, as the sweep would have retried it.
function importedFailure(r: HandledRow): boolean {
  return r.runId === null && r.status === 'failed' && r.failedAt !== null
}

export function handledStates(rows: readonly HandledRow[]): Map<string, HandledState> {
  return new Map(
    rows.map((r) => [
      r.onceKey,
      r.runId === null && !importedFailure(r) ? HELD : { status: r.status, failedAt: r.failedAt }
    ])
  )
}

// A script check (spec §1): /bin/sh -c in the main checkout, the item on stdin; exit 0 passes.
export async function runScriptCheck(
  check: ScriptCheck,
  item: DecideItem,
  def: AutomationDefinition,
  repo: RepoFacts,
  run: ScriptRunner,
  engineEnv: EngineEnv
): Promise<CheckResult> {
  const extra: Record<string, string> = { PILOT_AUTOMATION_ID: def.id, PILOT_ITEM_KEY: item.key }
  const worktree = item.fields['worktree.path']
  if (typeof worktree === 'string') {
    extra.PILOT_WORKTREE_PATH = worktree
  }
  let result
  try {
    result = await run({
      command: resolveScriptCommand(check.run, def.file),
      cwd: repo.path,
      stdin: JSON.stringify({ key: item.key, label: item.label, fields: item.fields }),
      env: engineChildEnv(engineEnv, extra),
      timeoutMs: check.timeoutMs
    })
  } catch (error) {
    return { ok: false, reason: `The check couldn't start: ${messageOf(error)}` }
  }
  if (result.timedOut) {
    return { ok: false, reason: `The check timed out after ${Math.round(check.timeoutMs / 1000)}s` }
  }
  const said = lastLine(result.stdout) || lastLine(result.stderr)
  if (result.code === 0) {
    return { ok: true, reason: said || 'The check passed' }
  }
  return { ok: false, reason: said || `The check exited ${result.code}` }
}

// Runs before the pure decision: only for items that reach the checks, in order, and only while
// every earlier check passes, so no script runs for an item an earlier check already skips.
async function scriptChecks(
  input: Omit<DecideInput, 'scriptChecks'>,
  repo: RepoFacts,
  run: ScriptRunner,
  engineEnv: EngineEnv
): Promise<Map<string, Map<number, CheckResult>>> {
  const def = input.definition
  const out = new Map<string, Map<number, CheckResult>>()
  if (!def.checks.some((c) => c.kind === 'script')) {
    return out
  }
  await mapLimit(input.items, SCRIPT_CHECK_CONCURRENCY, async (item) => {
    if (preCheckGate(input, item)) {
      return
    }
    const ctx = { label: item.label, fields: item.fields, now: input.now, timeZone: def.timezone }
    const results = new Map<number, CheckResult>()
    for (const [index, check] of def.checks.entries()) {
      if (check.kind !== 'script') {
        if (!evaluateCheck(check, ctx).ok) {
          break
        }
        continue
      }
      const result = await runScriptCheck(check, item, def, repo, run, engineEnv)
      results.set(index, result)
      if (!result.ok) {
        break
      }
    }
    out.set(item.key, results)
  })
  return out
}

function toDecideItem(item: Item, seenAt: ReadonlyMap<string, number>, now: number): DecideItem {
  return {
    key: item.key,
    label: item.label,
    fields: item.fields,
    sortKeys: {
      waitingSince: item.sortKeys.waitingSince ?? seenAt.get(item.key) ?? now,
      priority: item.sortKeys.priority
    }
  }
}

// Worktrees with a running run of any automation, less the repo's main checkout: a main_checkout run
// records the repo path as its worktree, and that checkout is shared (G2/B2).
function busyWorktrees(store: PilotStore, repo: RepoFacts): Set<string> {
  const main = worktreePathKey(repo.path)
  const busy = store.runs.runningWorktreePaths()
  for (const path of busy) {
    if (worktreePathKey(path) === main) {
      busy.delete(path)
    }
  }
  return busy
}

// Contract §6 across concurrent ticks: busyWorktrees was read when deciding, and runs are created after
// awaits, so another tick (or Run now) may have taken the worktree since. Checked synchronously right
// before a run is created, by the same rule as busyWorktrees: the repo's main checkout is shared, and
// main_checkout runs are exempt. Returns the path that is taken, or null.
export function worktreeTakenSinceDecide(
  store: PilotStore,
  def: AutomationDefinition,
  path: string | null,
  fields: ItemDecision['fields']
): string | null {
  if (def.workspace.kind !== 'item_worktree' || path === null) {
    return null
  }
  const key = worktreePathKey(path)
  const main = fields['repo.path']
  if (typeof main === 'string' && worktreePathKey(main) === key) {
    return null
  }
  const taken =
    store.runs.runningInWorktree(path).length > 0 ||
    (key !== path && store.runs.runningInWorktree(key).length > 0)
  return taken ? path : null
}

// One automation's decision (spec §6): repo → items → built-in fields → scope → custom fields →
// script checks → decideTick. A failing source or worktree listing throws; the tick runner records
// the tick as failed and the next one retries. `tickId` is the tick row the runner started first (G3).
export async function decideTickItems(
  def: AutomationDefinition,
  people: PeopleDirectory,
  deps: DecideDeps,
  pass: PassFetchCache,
  tickId: number
): Promise<DecideOutcome> {
  const now = deps.now()
  const repo = await deps.resolveRepo(def.repo)
  const ids = await idsForTick(def, repo, deps)
  const ctx: SourceContext = {
    repo,
    people,
    fetch: pass,
    now,
    automationId: def.id,
    ids: ids?.ids ?? null
  }
  const listed = await deps.sources.list(def, ctx)
  const tickFields = runFields({ automationId: def.id, at: now, timezone: def.timezone, tickId })
  const withTick = listed.items.map((item) => ({
    ...item,
    fields: { ...tickFields, ...item.fields }
  }))
  const withBuiltins = await addBuiltinFields(def, withTick, repo, deps.fields)
  const scope = new Map<string, ScopeGate>()
  for (const item of withBuiltins) {
    const gate = deps.sources.scope(def, item, people)
    if (gate) {
      scope.set(item.key, gate)
    }
  }
  const custom = await addCustomFields(
    def,
    withBuiltins,
    { inScope: (item) => !scope.has(item.key), repoPath: repo.path, pass },
    deps.fields
  )
  const activity = deps.activity
    ? await addActivityFacts(
        custom.items,
        def.checks,
        deps.activity,
        (item) => !scope.has(item.key)
      )
    : { items: custom.items, warnings: [] }
  const seenAt = deps.store.seenTimes(def.id)
  const input = {
    definition: def,
    items: activity.items.map((item) => toDecideItem(item, seenAt, now)),
    now,
    scope,
    handled: handledStates(deps.store.handledRows(def.id)),
    seenKeys: new Set(seenAt.keys()),
    activeRuns: deps.store.runs.runningCount(def.id),
    busyWorktrees: busyWorktrees(deps.store, repo),
    notDue: custom.notDue
  }
  const decisions = decideTick({
    ...input,
    scriptChecks: await scriptChecks(input, repo, deps.fields.runScript, deps.fields.engineEnv)
  })
  return {
    decisions,
    warnings: [
      ...(ids?.warnings ?? []),
      ...listed.warnings,
      ...custom.warnings,
      ...activity.warnings
    ],
    fed: ids?.fed ?? [],
    dropped: ids?.dropped ?? [],
    missing: listed.missing ?? [],
    skipped: listed.skipped ?? []
  }
}
