import type { CheckOutcome, ItemDecision, TickItem } from '../api-types'
import type { AutomationDefinition, MergeRequestWhere } from '../definition/types'
import { describeRef, personByGitlab, refIncludes, type PeopleDirectory } from '../people'
import { oncePerKey } from '../template'
import { evaluateCheck } from './checks'

// M1's merge-request rules read the where block directly; Task 4a moves them into the source's scope().
function mrWhere(def: AutomationDefinition): MergeRequestWhere {
  return (def.items?.where ?? {}) as MergeRequestWhere
}

export type DecideInput = {
  definition: AutomationDefinition
  items: TickItem[]
  people: PeopleDirectory
  handledKeys: ReadonlySet<string>
  seenKeys: ReadonlySet<string>
  runningCount: number
}

type Gate = { verdict: ItemDecision['verdict']; reason: string } | null

type AuthorCheck = { ok: true } | { ok: false; reason: string }

// anyone/absent: no lookup; a people or group ref needs the author in people.yaml.
function authorCheck(
  def: AutomationDefinition,
  people: PeopleDirectory,
  username: string
): AuthorCheck {
  const ref = mrWhere(def).author
  if (ref === undefined || ref === 'anyone') {
    return { ok: true }
  }
  const person = personByGitlab(people, username)
  if (!person) {
    return { ok: false, reason: `Author ${username} isn't in people.yaml` }
  }
  if (refIncludes(ref, person.id, people)) {
    return { ok: true }
  }
  return {
    ok: false,
    reason: `Author is ${person.name}; this automation looks at ${describeRef(ref, people)}`
  }
}

export function authorInScope(
  def: AutomationDefinition,
  people: PeopleDirectory,
  username: string
): boolean {
  return authorCheck(def, people, username).ok
}

function scopeGate(def: AutomationDefinition, item: TickItem, people: PeopleDirectory): Gate {
  const where = mrWhere(def)
  const state = item.fields['mr.state']
  if (where.state === 'open' && state !== 'open') {
    return { verdict: 'out_of_scope', reason: `MR is ${state ?? '(state unknown)'}` }
  }
  const username = String(item.fields['mr.author'] ?? '(unknown)')
  const author = authorCheck(def, people, username)
  return author.ok ? null : { verdict: 'out_of_scope', reason: author.reason }
}

function dueGate(def: AutomationDefinition, item: TickItem): Gate {
  const status = item.fields['mr.pipeline_status']
  if (mrWhere(def).head_pipeline === 'failed' && status !== 'failed') {
    return { verdict: 'notdue', reason: `Head pipeline ${status ?? 'missing'}` }
  }
  return null
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

// The tick algorithm (spec §6 steps 3–6): scope → due → once_per → first-seen baseline → checks → limits.
// per_tick and at_once apply in the caller's item order (Task 17 sorts by iid).
export function decideTick(input: DecideInput): ItemDecision[] {
  const { definition: def, people, handledKeys, seenKeys, runningCount } = input
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
    const gate = scopeGate(def, item, people) ?? dueGate(def, item)
    if (gate) {
      return { ...base, ...gate }
    }
    if (handledKeys.has(onceKey) || startedOnceKeys.has(onceKey)) {
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
