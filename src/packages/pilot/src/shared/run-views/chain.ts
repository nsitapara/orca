import type { AgentKind, AutomationDefinition, CheckDef, StepAgent } from '../definition/types'
import { checkName } from '../tick/checks'
import {
  answersText,
  checksText,
  FIELD_PREFIX,
  handoverText,
  mergeBackText,
  idsCommand,
  itemKindShort,
  picksText,
  startsText,
  stepRunsText,
  stepShort,
  workspaceGives,
  workspaceText
} from './chain-text'

export type Who = 'pilot' | 'script' | 'agent' | 'you'
export type ChainGroup = 'before' | 'steps' | 'asks' | 'after'
export type PartKind =
  | 'starts'
  | 'picks'
  | 'ids'
  | 'field'
  | 'gates'
  | 'check'
  | 'ask'
  | 'workspace'
  | 'step'
  | 'answers'
  | 'merge_back'
  | 'handover'

// One part of an automation's chain, in the order a run meets it (spec §1). `key` is stable across loads: paintRun,
// the strip's chips and openRun's `part` all name a part by it.
export type ChainPart = {
  key: string
  kind: PartKind
  group: ChainGroup
  who: Who
  // A ↳ row: a script the Pilot part above it runs.
  sub: boolean
  name: string
  // The words its strip chip shows.
  short: string
  // What it runs: the command, the agent and skill, or plain words.
  runs: string
  agent: AgentKind | null
  skill: string | null
  // The condition it runs under (a step's when:, a handover's "this run succeeds").
  when: string | null
  always: boolean
  // What later parts read from it: a step's outputs, a field's name, env.*.
  gives: string[]
  stepIdx: number | null
  // The check names (checkName) a Gates or check row stands for: a tick item's CheckOutcome.check finds its row by them.
  checks: string[]
  // A handover's receiving automation.
  to: string | null
}

type PartFields = Pick<ChainPart, 'key' | 'kind' | 'group' | 'who' | 'name' | 'runs'> &
  Partial<ChainPart>

export function chainPart(p: PartFields): ChainPart {
  return {
    sub: false,
    short: p.name,
    agent: null,
    skill: null,
    when: null,
    always: false,
    gives: [],
    stepIdx: null,
    checks: [],
    to: null,
    ...p
  }
}

function agentOf(agent: StepAgent): AgentKind | null {
  return agent === 'shell' ? null : agent
}

function fieldParts(def: AutomationDefinition): ChainPart[] {
  const items = def.items
  if (!items) {
    return []
  }
  return items.customFields.map((f) =>
    chainPart({
      key: `field:${f.name}`,
      kind: 'field',
      group: 'before',
      who: 'script',
      sub: true,
      name: f.name,
      runs: f.script,
      gives: [`${FIELD_PREFIX[items.kind]}.${f.name}`]
    })
  )
}

// One Gates row for the checks Pilot makes itself, then a ↳ row per check script, keyed by its place in checks: (two
// scripts can share a name).
function gateParts(checks: readonly CheckDef[]): ChainPart[] {
  if (checks.length === 0) {
    return []
  }
  const plain = checks.filter((c) => c.kind !== 'script')
  const gates = chainPart({
    key: 'gates',
    kind: 'gates',
    group: 'before',
    who: 'pilot',
    name: 'Gates',
    runs: checksText(plain),
    checks: plain.map(checkName)
  })
  const scripts = checks.flatMap((c, i) =>
    c.kind === 'script'
      ? [
          chainPart({
            key: `check:${i}`,
            kind: 'check',
            group: 'before',
            who: 'script',
            sub: true,
            name: checkName(c),
            runs: c.run,
            checks: [checkName(c)]
          })
        ]
      : []
  )
  return [gates, ...scripts]
}

function beforeParts(def: AutomationDefinition, all: readonly AutomationDefinition[]): ChainPart[] {
  const parts = [
    chainPart({
      key: 'starts',
      kind: 'starts',
      group: 'before',
      who: 'pilot',
      name: 'Starts',
      runs: startsText(def, all)
    }),
    chainPart({
      key: 'picks',
      kind: 'picks',
      group: 'before',
      who: 'pilot',
      name: 'Picks',
      runs: picksText(def),
      short: itemKindShort(def)
    })
  ]
  const ids = idsCommand(def)
  if (ids) {
    parts.push(
      chainPart({
        key: 'ids',
        kind: 'ids',
        group: 'before',
        who: 'script',
        sub: true,
        name: 'ids',
        runs: ids
      })
    )
  }
  parts.push(...fieldParts(def), ...gateParts(def.checks))
  if (def.start === 'ask_first') {
    parts.push(
      chainPart({
        key: 'ask',
        kind: 'ask',
        group: 'before',
        who: 'you',
        name: 'Asks you',
        short: 'asks you',
        runs: def.askFirst?.title ?? `Start "${def.name}"?`
      })
    )
  }
  parts.push(
    chainPart({
      key: 'workspace',
      kind: 'workspace',
      group: 'before',
      who: 'pilot',
      name: 'Workspace',
      runs: workspaceText(def.workspace),
      gives: workspaceGives(def.workspace)
    })
  )
  return parts
}

function stepParts(def: AutomationDefinition): ChainPart[] {
  return def.steps.map((s, i) =>
    chainPart({
      key: `step:${i}`,
      kind: 'step',
      group: 'steps',
      who: s.agent === 'shell' ? 'script' : 'agent',
      name: s.name,
      short: stepShort(s),
      runs: stepRunsText(s),
      agent: agentOf(s.agent),
      skill: s.skill,
      when: s.when,
      always: s.always,
      gives: s.outputs,
      stepIdx: i
    })
  )
}

// A run in a throwaway leaves what reached neither your worktree nor origin on pilot/<run>; the kept_branch job merges it.
function mergeBackParts(
  def: AutomationDefinition,
  all: readonly AutomationDefinition[]
): ChainPart[] {
  if (def.workspace.kind !== 'env' || def.items?.kind === 'kept_branch') {
    return []
  }
  const job = all.find((d) => d.items?.kind === 'kept_branch')
  return [
    chainPart({
      key: 'merge_back',
      kind: 'merge_back',
      group: 'after',
      who: 'pilot',
      name: 'Merge back',
      short: 'merge back',
      runs: mergeBackText(job?.name ?? null)
    })
  ]
}

function answerParts(def: AutomationDefinition): ChainPart[] {
  if (!def.answers) {
    return []
  }
  return [
    chainPart({
      key: 'answers',
      kind: 'answers',
      group: 'asks',
      who: 'you',
      name: 'Answers',
      short: 'answers',
      runs: answersText(def.answers)
    })
  ]
}

function handoverParts(
  def: AutomationDefinition,
  all: readonly AutomationDefinition[]
): ChainPart[] {
  const stageOf = (id: string) => all.find((d) => d.id === id)?.job?.stage ?? null
  return (def.job?.feeds ?? [])
    .filter((f) => f.pass !== null || f.run === 'now')
    .map((f) =>
      chainPart({
        key: `handover:${f.to}`,
        kind: 'handover',
        group: 'after',
        who: 'pilot',
        name: 'Hands over',
        runs: handoverText(f, stageOf(f.to)),
        when: f.when === 'success' ? 'this run succeeds' : null,
        to: f.to
      })
    )
}

// An automation's parts in the order a run meets them (spec §1): what Pilot does before any step and the scripts it runs
// there, the ask, each step, what an answer starts, and what it hands the next stage. `all`: every loaded definition,
// for the stages that feed this one and the stage numbers it hands to.
export function chainOf(
  def: AutomationDefinition,
  all: readonly AutomationDefinition[]
): ChainPart[] {
  return [
    ...beforeParts(def, all),
    ...stepParts(def),
    ...mergeBackParts(def, all),
    ...answerParts(def),
    ...handoverParts(def, all)
  ]
}

// The check names a tick item records, in the order the YAML lists them: the columns of Activity's "Why" table.
export function checkNamesOf(chain: readonly ChainPart[]): string[] {
  return chain.flatMap((p) => (p.kind === 'gates' || p.kind === 'check' ? p.checks : []))
}
