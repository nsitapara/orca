import type { CheckOutcome, ItemDecision, ItemFields, Verdict } from '../api-types'
import type { AutomationDefinition } from '../definition/types'
import { evalExpr, parseExpr } from '../expr'
import { oncePerKey, renderTemplate } from '../template'
import { isRuntimeCheck } from './check-class'
import { evaluateCheck, fieldLookup, plural, type CheckResult } from './checks'
import { inTickGate, itemGate, limitGate, type Hold } from './runner-gates'

// waitingSince: when the source says the item began waiting, its due time in the runner's line. seenAt: when this
// job first saw it, which only ranks it within the job (oldest_waiting_first) when the source gives no time.
export type DecideItem = {
  key: string
  label: string
  fields: ItemFields
  sortKeys?: { waitingSince: number | null; priority: number | null; seenAt?: number | null }
}
export type ScopeGate = { verdict: 'out_of_scope' | 'notdue'; reason: string }
export type HandledState = {
  status: 'started' | 'done' | 'failed'
  failedAt: number | null
  // Failed runs in a row on the key, and the last run's outcome: the runner's retry gate reads both.
  failures: number
  lastOutcome: string | null
}
// Item key → index in definition.checks → the script's result.
export type ScriptCheckResults = ReadonlyMap<string, ReadonlyMap<number, CheckResult>>
export type DecideInput = {
  definition: AutomationDefinition
  items: DecideItem[]
  now: number
  scope: ReadonlyMap<string, ScopeGate>
  handled: ReadonlyMap<string, HandledState>
  seenKeys: ReadonlySet<string>
  activeRuns: number
  busyWorktrees: ReadonlySet<string>
  scriptChecks: ScriptCheckResults
  // Items a field script said aren't due now (exit 3): item key → its reason. Skipped this tick, after scope, once_per
  // and first_seen; a fed id stays pending (main/handover/tick-handover.ts settles).
  notDue?: ReadonlyMap<string, string>
  // Retries after a failure (the Running page); a key failed more often than this is given up.
  retryLimit: number
  // Run now: every given-up key is due again.
  byHand: boolean
  // Items (by item key or once key) Run now or Retry started by hand: their given-up key is due again.
  byHandKeys?: ReadonlySet<string>
}
type Gate = { verdict: Verdict; reason: string }
type Candidate = {
  index: number
  item: DecideItem
  onceKey: string
  checks: CheckOutcome[]
  path: string | null
}

function matchGate(def: AutomationDefinition, item: DecideItem): Gate | null {
  for (const source of def.items?.match ?? []) {
    const parsed = parseExpr(source)
    if (!parsed.ok) {
      return { verdict: 'out_of_scope', reason: `Invalid match "${source}": ${parsed.error}` }
    }
    if (!evalExpr(parsed.expr, fieldLookup(item.fields))) {
      return { verdict: 'out_of_scope', reason: `Doesn't match "${source}"` }
    }
  }
  return null
}

// A failed key stays due while the runner retries it (its retry gate waits), and by hand past the retry limit.
// An ask-first job's isn't retried: you approve each run.
function handledGate(
  input: Omit<DecideInput, 'scriptChecks'>,
  item: DecideItem,
  onceKey: string
): Gate | null {
  const state = input.handled.get(onceKey)
  if (!state) {
    return null
  }
  // Failed before failures were counted (0; a new failure counts 1): as before, only retry_after_failure retries it.
  if (
    state.status === 'failed' &&
    state.failures === 0 &&
    input.definition.retryAfterFailureMs !== null
  ) {
    return null
  }
  if (state.status !== 'failed' || state.failures === 0 || input.definition.start === 'ask_first') {
    return { verdict: 'notdue', reason: `Already handled ${onceKey}` }
  }
  const byHand =
    input.byHand ||
    input.byHandKeys?.has(item.key) === true ||
    input.byHandKeys?.has(onceKey) === true
  if (state.failures > input.retryLimit && !byHand) {
    const failures = plural(state.failures, 'failure')
    const reason = `Gave up after ${failures}; Run now or Retry from Running starts it again`
    return { verdict: 'notdue', reason }
  }
  return null
}

// A source that tracks its items' progress itself (the worktree kind's `commits` clause) says whether
// an item is at first sight in `item.baseline`: a rewritten history is a first sight again (03), and
// recent work seen for the first time is not (04). Otherwise an item is first seen when `seen` lacks it.
export function firstSight(
  item: { key: string; fields: ItemFields },
  seenKeys: ReadonlySet<string>
): boolean {
  const own = item.fields['item.baseline']
  return typeof own === 'boolean' ? own : !seenKeys.has(item.key)
}

// Spec §6 before the checks: scope (the source's scope() and items.match), once_per, first_seen, then a field script's not due.
// A not-due item skips items.match: its script stopped the later field scripts, so a match on one of their fields would
// fail on a null and hide the script's reason (and consume a handed-over id). Scope, handled and baselined still win.
// Run-once automations skip scope and first_seen, and once_per unless they set one (once per local
// day with "{run.date}"). Exported so the tick runner runs script checks only for items that reach
// the checks.
export function preCheckGate(
  input: Omit<DecideInput, 'scriptChecks'>,
  item: DecideItem
): Gate | null {
  const def = input.definition
  const onceKey = oncePerKey(def.oncePer, item.fields, item.key)
  if (def.items === null) {
    return usesHandled(def) ? handledGate(input, item, onceKey) : null
  }
  // A not-due item's field may be null (its script stopped the later ones), so items.match would misread it as out of scope.
  const notDue = input.notDue?.get(item.key)
  const scoped = input.scope.get(item.key) ?? (notDue === undefined ? matchGate(def, item) : null)
  if (scoped) {
    return scoped
  }
  const handled = handledGate(input, item, onceKey)
  if (handled) {
    return handled
  }
  if (def.firstSeen === 'baseline' && firstSight(item, input.seenKeys)) {
    return { verdict: 'baselined', reason: 'First time seen: recorded, not acted on' }
  }
  if (notDue !== undefined) {
    return { verdict: 'skipped', reason: notDue }
  }
  return null
}

// A run-once automation without once_per runs on every tick (contract §1): its key is never handled.
export function usesHandled(def: AutomationDefinition): boolean {
  return def.items !== null || def.oncePer !== null
}

// The path the cross-automation worktree rule compares: the item's own worktree. A new worktree can't
// collide with another run, and the repo's main checkout is shared by design (G2/B2), so neither has one.
export function workspacePathOf(def: AutomationDefinition, fields: ItemFields): string | null {
  if (def.workspace.kind !== 'item_worktree') {
    return null
  }
  const value = fields['worktree.path']
  return typeof value === 'string' && value !== '' ? value : null
}

type ChecksRun = {
  checks: CheckOutcome[]
  failed: CheckOutcome | null
  failedClass: 'eligibility' | 'runtime' | null
}

// Eligibility checks first, then runtime checks, each in declared order: an item that isn't eligible is
// skipped even when a runtime check declared before its eligibility check fails.
function runChecks(input: DecideInput, item: DecideItem): ChecksRun {
  const def = input.definition
  const ctx = { label: item.label, fields: item.fields, now: input.now, timeZone: def.timezone }
  const scripts = input.scriptChecks.get(item.key)
  const indexed = [...def.checks.entries()]
  const ordered = [
    ...indexed.filter(([, c]) => !isRuntimeCheck(c)),
    ...indexed.filter(([, c]) => isRuntimeCheck(c))
  ]
  const checks: CheckOutcome[] = []
  for (const [index, c] of ordered) {
    const result = evaluateCheck(c, ctx, scripts?.get(index))
    checks.push(result)
    if (!result.ok) {
      return { checks, failed: result, failedClass: isRuntimeCheck(c) ? 'runtime' : 'eligibility' }
    }
  }
  return { checks, failed: null, failedClass: null }
}

function sortValue(value: number | null | undefined): number {
  return value ?? Number.POSITIVE_INFINITY
}

function ranked(def: AutomationDefinition, candidates: Candidate[]): Candidate[] {
  const order = def.limits.order
  if (order === 'listed') {
    return candidates
  }
  const key = (c: Candidate) =>
    order === 'priority'
      ? sortValue(c.item.sortKeys?.priority)
      : sortValue(c.item.sortKeys?.waitingSince ?? c.item.sortKeys?.seenAt)
  return [...candidates].sort((a, b) => key(a) - key(b) || a.index - b.index)
}

function askedReason(def: AutomationDefinition, fields: ItemFields): string {
  if (!def.askFirst) {
    return 'Asks before starting'
  }
  return `Asks first: ${renderTemplate(def.askFirst.title, fields).text}`
}

function base(item: DecideItem, onceKey: string) {
  return { key: item.key, label: item.label, onceKey, fields: item.fields }
}

// An item that reached the checks has a place in the runner's line: since it began waiting, else now (the store keeps
// the earliest), so an item first seen long ago doesn't jump ahead of one that waits since this morning.
function reachedChecks(
  input: DecideInput,
  item: DecideItem,
  onceKey: string,
  checks: CheckOutcome[]
) {
  return { ...base(item, onceKey), checks, dueAt: item.sortKeys?.waitingSince ?? input.now }
}

function held(decided: ReturnType<typeof reachedChecks>, hold: Hold): ItemDecision {
  return { ...decided, verdict: 'held', reason: hold.detail, hold }
}

// The per-tick slots go out in limits.order; decisions keep the source's order. A held item takes no
// slot, so the next one is tried.
function allocate(input: DecideInput, candidates: Candidate[], out: ItemDecision[]): void {
  const def = input.definition
  const onceKeys = new Set<string>()
  const paths = new Set<string>()
  let taken = 0
  let started = 0
  for (const c of ranked(def, candidates)) {
    const decided = reachedChecks(input, c.item, c.onceKey, c.checks)
    if (usesHandled(def) && onceKeys.has(c.onceKey)) {
      out[c.index] = { ...decided, verdict: 'notdue', reason: `Already handled ${c.onceKey}` }
      continue
    }
    const hold =
      inTickGate(c.path, c.item.fields, paths) ?? limitGate(def, taken, input.activeRuns + started)
    if (hold) {
      out[c.index] = held(decided, hold)
      continue
    }
    taken += 1
    onceKeys.add(c.onceKey)
    if (def.start === 'ask_first') {
      out[c.index] = { ...decided, verdict: 'asked', reason: askedReason(def, c.item.fields) }
      continue
    }
    started += 1
    if (c.path !== null) {
      paths.add(c.path)
    }
    out[c.index] = { ...decided, verdict: 'started', reason: 'All checks pass' }
  }
}

export function decideTick(input: DecideInput): ItemDecision[] {
  const def = input.definition
  // Filled by index: every item gets exactly one decision, here or in allocate().
  const out: ItemDecision[] = []
  const candidates: Candidate[] = []
  input.items.forEach((item, index) => {
    const onceKey = oncePerKey(def.oncePer, item.fields, item.key)
    const gate = preCheckGate(input, item)
    if (gate) {
      out[index] = { ...base(item, onceKey), checks: [], ...gate }
      return
    }
    const { checks, failed, failedClass } = runChecks(input, item)
    if (failed && failedClass === 'eligibility') {
      const decided = reachedChecks(input, item, onceKey, checks)
      out[index] = { ...decided, verdict: 'skipped', reason: failed.reason }
      return
    }
    const path = workspacePathOf(def, item.fields)
    // The runner's gates own the hold; they re-read the runtime checks recorded above.
    const hold = itemGate(input, item, onceKey, path)
    if (hold) {
      out[index] = held(reachedChecks(input, item, onceKey, checks), hold)
      return
    }
    candidates.push({ index, item, onceKey, checks, path })
  })
  allocate(input, candidates, out)
  return out
}
