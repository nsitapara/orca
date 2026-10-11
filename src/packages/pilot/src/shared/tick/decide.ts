import type { CheckOutcome, ItemDecision, ScopeResult, TickItem } from '../api-types'
import type { AutomationDefinition } from '../definition/types'
import { oncePerKey } from '../template'
import { evaluateCheck } from './checks'

export type DecideInput<I extends TickItem = TickItem> = {
  definition: AutomationDefinition
  items: I[]
  // The item source's verdict on an item's where clauses (shared/tick/scope.ts), passed in so this
  // stays pure.
  scope(item: I): ScopeResult
  handledKeys: ReadonlySet<string>
  seenKeys: ReadonlySet<string>
  runningCount: number
}

type Gate = { verdict: ItemDecision['verdict']; reason: string } | null

// A run-once automation without once_per runs on every tick (contract §1): its key is never handled.
export function usesHandled(def: AutomationDefinition): boolean {
  return def.items !== null || def.oncePer !== null
}

function runChecks(
  def: AutomationDefinition,
  item: TickItem
): { checks: CheckOutcome[]; failed: CheckOutcome | null } {
  const checks: CheckOutcome[] = []
  for (const c of def.checks) {
    const result = evaluateCheck(c, item.fields)
    checks.push(result)
    if (!result.ok) {
      return { checks, failed: result }
    }
  }
  return { checks, failed: null }
}

function limitGate(def: AutomationDefinition, startedSoFar: number, running: number): Gate {
  const { perTick, atOnce } = def.limits
  if (perTick !== null && startedSoFar >= perTick) {
    return { verdict: 'over_limit', reason: `Over the limit of ${perTick} per tick` }
  }
  if (atOnce !== null && running + startedSoFar >= atOnce) {
    return { verdict: 'over_limit', reason: `At most ${atOnce} at once` }
  }
  return null
}

// The tick algorithm (spec §6 steps 3–6): scope → once_per → first-seen baseline → checks → limits.
// per_tick and at_once apply in the caller's item order (the merge-request source lists by iid).
export function decideTick<I extends TickItem>(input: DecideInput<I>): ItemDecision[] {
  const { definition: def, handledKeys, seenKeys, runningCount } = input
  const tracksHandled = usesHandled(def)
  let started = 0
  const startedOnceKeys = new Set<string>()
  const startedWorktrees = new Set<string>()
  return input.items.map((item) => {
    const onceKey = oncePerKey(def.oncePer, item.fields, item.key)
    const base = {
      key: item.key,
      label: item.label,
      onceKey,
      fields: item.fields,
      checks: [] as CheckOutcome[]
    }
    const scope = input.scope(item)
    if (!scope.ok) {
      return { ...base, verdict: scope.verdict, reason: scope.reason }
    }
    if (tracksHandled && (handledKeys.has(onceKey) || startedOnceKeys.has(onceKey))) {
      return { ...base, verdict: 'notdue', reason: `Already handled ${onceKey}` }
    }
    if (def.firstSeen === 'baseline' && !seenKeys.has(item.key)) {
      return { ...base, verdict: 'baselined', reason: 'First time seen: recorded, not acted on' }
    }
    const { checks, failed } = runChecks(def, item)
    if (failed) {
      return { ...base, checks, verdict: 'skipped', reason: failed.reason }
    }
    const path = item.fields['worktree.path']
    if (typeof path === 'string' && startedWorktrees.has(path)) {
      return {
        ...base,
        checks,
        verdict: 'skipped',
        reason: `Another run starts in ${path} this tick`
      }
    }
    const limit = limitGate(def, started, runningCount)
    if (limit) {
      return { ...base, checks, ...limit }
    }
    started += 1
    startedOnceKeys.add(onceKey)
    if (typeof path === 'string') {
      startedWorktrees.add(path)
    }
    return { ...base, checks, verdict: 'started', reason: 'All checks pass' }
  })
}
