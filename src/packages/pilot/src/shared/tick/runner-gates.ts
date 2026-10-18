import type { HoldReason, ItemFields } from '../api-types'
import type { AgentKind, AutomationDefinition } from '../definition/types'
import { QUOTA_CEILING } from '../quota-ceiling'
import { worktreePathKey } from '../worktree-path-key'
import { holdCodeOf, isRuntimeCheck } from './check-class'
import { evaluateCheck, fieldLookup } from './checks'
import type { DecideInput, DecideItem } from './decide'

// The job decides what is due; these gates decide when it starts. A failing gate holds the item in the
// runner's line with its reason instead of skipping it.
export type Hold = { code: HoldReason; detail: string }

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
          detail: `${agent} ${window} limit at ${used}% (jobs stop at ${ceiling}%)`
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

// The job's runtime checks in declared order, each agent's quota, then another run in the item's worktree.
export function itemGate(input: DecideInput, item: DecideItem, path: string | null): Hold | null {
  return (
    declaredHold(input, item) ??
    implicitQuotaHold(input.definition, item.fields) ??
    busyHold(input.busyWorktrees, path)
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

export function limitGate(def: AutomationDefinition, taken: number, active: number): Hold | null {
  const { perTick, atOnce } = def.limits
  if (perTick !== null && taken >= perTick) {
    return { code: 'job_limit', detail: `Over the limit of ${perTick} per tick` }
  }
  if (atOnce !== null && active >= atOnce) {
    return { code: 'job_limit', detail: `At most ${atOnce} at once` }
  }
  return null
}
