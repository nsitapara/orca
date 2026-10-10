import type { CheckOutcome, ItemDecision, TickItem } from '../api-types'
import type { AutomationDefinition } from '../definition/types'
import { describeRef, personByGitlab, refIncludes, type PeopleDirectory } from '../people'
import { oncePerKey } from '../template'
import { evaluateCheck } from './checks'

export type DecideInput = {
  definition: AutomationDefinition
  items: TickItem[]
  people: PeopleDirectory
  handledKeys: ReadonlySet<string>
  seenKeys: ReadonlySet<string>
  runningCount: number
}

type Gate = { verdict: ItemDecision['verdict']; reason: string } | null

function scopeGate(def: AutomationDefinition, item: TickItem, people: PeopleDirectory): Gate {
  const where = def.items?.where ?? {}
  const state = item.fields['mr.state']
  if (where.state === 'open' && state !== 'open') {
    return { verdict: 'out_of_scope', reason: `MR is ${state}` }
  }
  // An explicit `anyone` still needs a mapped author (spec ruling); only an absent filter skips the lookup.
  if (where.author === undefined) {
    return null
  }
  const username = String(item.fields['mr.author'])
  const person = personByGitlab(people, username)
  if (!person) {
    return { verdict: 'out_of_scope', reason: `Author ${username} isn't in people.yaml` }
  }
  if (refIncludes(where.author, person.id, people)) {
    return null
  }
  return {
    verdict: 'out_of_scope',
    reason: `Author is ${person.name}; this automation looks at ${describeRef(where.author, people)}`
  }
}

function dueGate(def: AutomationDefinition, item: TickItem): Gate {
  const status = item.fields['mr.pipeline_status']
  if (def.items?.where.head_pipeline === 'failed' && status !== 'failed') {
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
export function decideTick(input: DecideInput): ItemDecision[] {
  const { definition: def, people, handledKeys, seenKeys, runningCount } = input
  let started = 0
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
    if (handledKeys.has(onceKey)) {
      return { ...base, verdict: 'notdue', reason: `Already handled ${onceKey}` }
    }
    if (def.firstSeen === 'baseline' && !seenKeys.has(item.key)) {
      return { ...base, verdict: 'baselined', reason: 'First time seen: recorded, not acted on' }
    }
    const { checks, failed } = runChecks(def, item)
    if (failed) {
      return { ...base, checks, verdict: 'skipped', reason: failed.reason }
    }
    const limit = limitGate(def, started, runningCount)
    if (limit) {
      return { ...base, checks, ...limit }
    }
    started += 1
    return { ...base, checks, verdict: 'started', reason: 'All checks pass' }
  })
}
