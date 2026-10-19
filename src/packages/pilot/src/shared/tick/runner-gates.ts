import type { HoldReason, ItemFields } from '../api-types'
import { DEFAULT_RETRY_AFTER_MS } from '../capacity/retry-limit'
import type { AgentKind, AutomationDefinition } from '../definition/types'
import { QUOTA_CEILING } from '../quota-ceiling'
import { localTimeOfDay } from '../schedule/cron'
import { worktreePathKey } from '../worktree-path-key'
import { holdCodeOf, isRuntimeCheck } from './check-class'
import { evaluateCheck, fieldLookup } from './checks'
import type { DecideInput, DecideItem } from './decide'

// The job decides what is due; these gates decide when it starts. A failing gate holds the item in the
// runner's line with its reason instead of skipping it.
export type Hold = { code: HoldReason; detail: string; until?: number }

// A failed key within the retry limit waits out its retry; past the limit only a run by hand reaches here.
function retryHold(input: DecideInput, onceKey: string): Hold | null {
  const state = input.handled.get(onceKey)
  if (state?.status !== 'failed' || state.failedAt === null || state.failures > input.retryLimit) {
    return null
  }
  const def = input.definition
  const dueAt = state.failedAt + (def.retryAfterFailureMs ?? DEFAULT_RETRY_AFTER_MS)
  if (dueAt <= input.now) {
    return null
  }
  // A key that failed before failures were counted reads as its first retry.
  const retry = `Retry ${Math.max(state.failures, 1)} of ${input.retryLimit}`
  const last = state.lastOutcome ? `Last run failed: ${state.lastOutcome}` : 'Last run failed'
  const detail = `${retry} at ${localTimeOfDay(dueAt, def.timezone)}. ${last}`
  return { code: 'retry', detail, until: dueAt }
}

function declaredHold(input: DecideInput, item: DecideItem): Hold | null {
  const def = input.definition
  const ctx = { label: item.label, fields: item.fields, now: input.now, timeZone: def.timezone }
  for (const check of def.checks) {
    if (!isRuntimeCheck(check)) {
      continue
    }
    const result = evaluateCheck(check, ctx)
    if (!result.ok) {
      return { code: holdCodeOf(check), detail: result.reason }
    }
  }
  return null
}

// A job's declared quota check for an agent is its own ceiling for that agent.
function implicitQuotaAgents(def: AutomationDefinition): AgentKind[] {
  const declared = new Set(def.checks.flatMap((c) => (c.kind === 'quota' ? [c.agent] : [])))
  const agents = new Set<AgentKind>()
  for (const step of def.steps) {
    const agent = step.agent
    if (agent !== 'shell' && !declared.has(agent)) {
      agents.add(agent)
    }
  }
  return [...agents]
}

// Asking first costs no quota, and an unreadable quota lets the run start.
function implicitQuotaHold(def: AutomationDefinition, fields: ItemFields): Hold | null {
  if (def.start === 'ask_first') {
    return null
  }
  const read = fieldLookup(fields)
  for (const agent of implicitQuotaAgents(def)) {
    for (const window of ['weekly', 'session'] as const) {
      const used = read(`quota.${agent}.${window}_pct`)
      const ceiling = QUOTA_CEILING[window]
      if (typeof used === 'number' && used >= ceiling) {
        return {
          code: 'quota',
          detail: `${agent} ${window} limit at ${Math.round(used)}% (jobs stop at ${ceiling}%)`
        }
      }
    }
  }
  return null
}

function busyHold(busy: ReadonlySet<string>, path: string | null): Hold | null {
  if (path === null || !busy.has(path)) {
    return null
  }
  return { code: 'worktree_busy', detail: `Another run is active in ${path}` }
}

// The job's own run still active on the item: an env job has no worktree path for busyHold, and a second run would race
// the first's push. A run-once job has no items, so at_once alone paces it.
function ownRunHold(input: DecideInput, item: DecideItem): Hold | null {
  if (input.definition.items === null || !input.activeItems?.has(item.key)) {
    return null
  }
  return { code: 'own_run', detail: `Another run of this job is still active on ${item.label}` }
}

// A failed run's retry, the job's runtime checks in declared order, each agent's quota, another run in the item's
// worktree, then the job's own run on the item.
export function itemGate(
  input: DecideInput,
  item: DecideItem,
  onceKey: string,
  path: string | null
): Hold | null {
  return (
    retryHold(input, onceKey) ??
    declaredHold(input, item) ??
    implicitQuotaHold(input.definition, item.fields) ??
    busyHold(input.busyWorktrees, path) ??
    ownRunHold(input, item)
  )
}

// The repo's main checkout is shared (G2/B2): items without a worktree of their own all work there.
function isMainCheckout(path: string, fields: ItemFields): boolean {
  const main = fields['repo.path']
  return typeof main === 'string' && worktreePathKey(main) === worktreePathKey(path)
}

export function inTickGate(
  path: string | null,
  fields: ItemFields,
  startingPaths: ReadonlySet<string>
): Hold | null {
  if (path === null || !startingPaths.has(path) || isMainCheckout(path, fields)) {
    return null
  }
  return { code: 'worktree_busy', detail: `Another run starts in ${path} this tick` }
}

// A per-tick overflow is re-decided at its job's next tick; a manual or turned-off job ticks only by Run now.
function tickLimitDetail(def: AutomationDefinition, perTick: number): string {
  const when =
    def.schedule === 'manual' || !def.enabled ? 'the next Run now' : "the job's next tick"
  return `Over the limit of ${perTick} per tick; starts at ${when}`
}

export function limitGate(def: AutomationDefinition, taken: number, active: number): Hold | null {
  const { perTick, atOnce } = def.limits
  if (perTick !== null && taken >= perTick) {
    return { code: 'tick_limit', detail: tickLimitDetail(def, perTick) }
  }
  if (atOnce !== null && active >= atOnce) {
    return { code: 'job_limit', detail: `At most ${atOnce} at once` }
  }
  return null
}
