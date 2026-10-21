import type {
  AgentKind,
  AnswersDef,
  AutomationDefinition,
  CheckDef,
  EnvWorkspaceDef,
  FeedDef,
  IdsFrom,
  ItemKind,
  StepDef,
  WorkspaceDef
} from '../definition/types'
import { checkName } from '../tick/checks'

// The words for each part of a chain (chain.ts): plain sentences from the YAML, never anything a run said.

const KIND_WORDS: Record<ItemKind, string> = {
  merge_request: 'Merge requests',
  worktree: 'Worktrees',
  pipeline: 'Pipelines',
  linear_ticket: 'Linear tickets',
  inbox_preparation: 'Inbox context requests',
  kept_branch: 'Kept fixes'
}
// The strip's first chip says what the automation looks at, short.
const KIND_SHORT: Record<ItemKind, string> = {
  merge_request: 'MRs',
  worktree: 'Worktrees',
  pipeline: 'Pipelines',
  linear_ticket: 'Tickets',
  inbox_preparation: 'Context requests',
  kept_branch: 'Kept fixes'
}
// The names templates read fields under ({mr.head8}); main/fields/custom-fields.ts writes them with the same prefixes.
export const FIELD_PREFIX: Record<ItemKind, string> = {
  merge_request: 'mr',
  worktree: 'worktree',
  pipeline: 'pipeline',
  linear_ticket: 'ticket',
  inbox_preparation: 'preparation',
  kept_branch: 'kept'
}
const AGENT_WORD: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }

export function agentWord(agent: AgentKind): string {
  return AGENT_WORD[agent]
}

// "Merge requests", or "Runs once" for an automation with no items: the list's summary and the Picks row.
export function itemKindWords(def: AutomationDefinition): string {
  return def.items ? KIND_WORDS[def.items.kind] : 'Runs once'
}

export function itemKindShort(def: AutomationDefinition): string {
  return def.items ? KIND_SHORT[def.items.kind] : 'Runs once'
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function scheduleWords(def: AutomationDefinition): string {
  return def.schedule === 'manual' ? 'by hand' : `on ${def.schedule} (${def.timezone})`
}

type Feeder = { stage: number | null; from: string; feed: FeedDef }

// The stages that hand this one ids or tick it (job.feeds pointing here), read from every loaded definition.
function feedersOf(def: AutomationDefinition, all: readonly AutomationDefinition[]): Feeder[] {
  return all.flatMap((d) =>
    (d.job?.feeds ?? [])
      .filter((f) => f.to === def.id && (f.pass !== null || f.run === 'now'))
      .map((feed) => ({ stage: d.job?.stage ?? null, from: d.id, feed }))
  )
}

function feederName(f: Feeder): string {
  return f.stage === null ? f.from : `stage ${f.stage}`
}

export function startsText(
  def: AutomationDefinition,
  all: readonly AutomationDefinition[]
): string {
  const feeder = feedersOf(def, all)[0]
  if (!feeder) {
    return capitalized(def.schedule === 'manual' ? 'run by hand' : scheduleWords(def))
  }
  const what = feeder.feed.caption ?? 'ids'
  if (feeder.feed.run === 'now') {
    return `When ${feederName(feeder)} hands it ${what}; otherwise ${scheduleWords(def)}`
  }
  return `${capitalized(scheduleWords(def))}, reading what ${feederName(feeder)} hands it`
}

function spaced(key: string): string {
  return key.replace(/_/g, ' ')
}

// A where value in words: people refs (`{ people: [nish] }`, `{ not: … }`, `{ group }`), lists and plain values.
function valueWords(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(valueWords).join(', ')
  }
  if (value === null || typeof value !== 'object') {
    return String(value)
  }
  const o = value as Record<string, unknown>
  if ('not' in o) {
    return `not ${valueWords(o.not)}`
  }
  if (Array.isArray(o.people)) {
    return o.people.join(', ')
  }
  if (typeof o.group === 'string') {
    return `group ${o.group}`
  }
  return Object.entries(o)
    .map(([k, v]) => `${spaced(k)} ${valueWords(v)}`)
    .join(', ')
}

// ids_from is a row of its own (the ids script); every other where key reads "reviewer nish".
function whereWords(where: Record<string, unknown>): string[] {
  return Object.entries(where)
    .filter(([key]) => key !== 'ids_from')
    .map(([key, value]) => `${spaced(key)} ${valueWords(value)}`)
}

export function picksText(def: AutomationDefinition): string {
  if (!def.items) {
    return 'Runs once'
  }
  const words = [KIND_WORDS[def.items.kind], ...whereWords(def.items.where)]
  if (def.items.match.length > 0) {
    words.push(`matching ${def.items.match.join(' and ')}`)
  }
  if (def.oncePer) {
    words.push(`once per ${def.oncePer}`)
  }
  if (def.limits.perTick !== null) {
    words.push(`up to ${def.limits.perTick} a tick`)
  }
  return words.join(' · ')
}

// where.ids_from.run: the command that prints the ids. Null when the source lists, or only reads handed-over ids.
export function idsCommand(def: AutomationDefinition): string | null {
  const from = def.items?.where.ids_from
  if (from === null || typeof from !== 'object') {
    return null
  }
  const run = (from as IdsFrom).run
  return typeof run === 'string' ? run : null
}

function checkWords(c: CheckDef): string {
  if (c.kind === 'quota') {
    return `${checkName(c)} under ${c.weekly}% week, ${c.session}% session`
  }
  return checkName(c)
}

// The Gates row: the checks Pilot makes itself (check scripts are ↳ rows of their own).
export function checksText(checks: readonly CheckDef[]): string {
  if (checks.length === 0) {
    return 'Only the check scripts below'
  }
  return checks.map(checkWords).join(' · ')
}

function envSubjectWords(ws: EnvWorkspaceDef): string {
  const s = ws.subject
  if (s.kind === 'worktree') {
    return `An env of ${s.worktree}`
  }
  if (s.kind === 'branch') {
    return `An env of ${s.branch} at ${s.at}`
  }
  return `An env on a new branch ${s.newBranch} from ${s.from}${s.keep ? ', kept' : ''}`
}

function envWords(ws: EnvWorkspaceDef): string {
  const words = [envSubjectWords(ws), ws.writes ? 'writes' : 'read only']
  const stack = typeof ws.stack === 'string' ? ws.stack : `{${ws.stack.field}}`
  if (stack !== 'never') {
    words.push(`stack ${stack}`)
  }
  return words.join(' · ')
}

export function workspaceText(ws: WorkspaceDef): string {
  switch (ws.kind) {
    case 'main_checkout':
      return 'The main checkout'
    case 'item_worktree':
      return "The item's worktree"
    case 'new_worktree':
      return `A new worktree ${ws.name} from ${ws.base}${ws.reuseExisting ? ', or the one already there' : ''}`
    case 'env':
      return envWords(ws)
  }
}

// What the steps can read from the workspace: {env.*} for an env, {worktree.path} for a worktree of the item's.
export function workspaceGives(ws: WorkspaceDef): string[] {
  if (ws.kind === 'env') {
    return ['env.*']
  }
  if (ws.kind === 'main_checkout') {
    return []
  }
  return ['worktree.path']
}

function skillWords(skill: string | null, mode: string | null): string | null {
  if (!skill) {
    return null
  }
  return mode ? `${skill} (${mode})` : skill
}

export function stepRunsText(step: StepDef): string {
  if (step.agent === 'shell') {
    return step.run ?? ''
  }
  const who = AGENT_WORD[step.agent]
  if (step.promptStyle === 'raw' && step.prompt) {
    return `${who} · ${step.prompt}`
  }
  return `${who} · ${skillWords(step.skill, step.mode) ?? 'its prompt'}`
}

// A step's chip: "Claude · fix-gitlab-ci", or a script step's name.
export function stepShort(step: StepDef): string {
  if (step.agent === 'shell') {
    return step.name
  }
  return `${AGENT_WORD[step.agent]} · ${step.skill ?? step.name}`
}

function agentSkillWords(a: NonNullable<AnswersDef['else']>): string {
  const skill = skillWords(a.skill, a.mode)
  const who = AGENT_WORD[a.agent]
  if (skill) {
    return `${who} · ${skill}`
  }
  return who
}

export function mergeBackText(jobName: string | null): string {
  const by = jobName
    ? `${jobName} merges it into your worktree`
    : 'no kept_branch job is loaded to merge it'
  return `When a throwaway's commits reach neither your worktree nor origin, they're kept on pilot/<run>; ${by}`
}

export function answersText(a: AnswersDef): string {
  const agent = a.else ? agentSkillWords(a.else) : null
  if (a.resume === 'never') {
    return agent ? `Your answer goes to ${agent}` : 'Your answer is kept'
  }
  return agent
    ? `Your answer resumes the asking session; otherwise ${agent}`
    : 'Your answer resumes the asking session'
}

function feedWhat(feed: FeedDef): string {
  if (feed.caption) {
    return feed.caption
  }
  return feed.pass ? `its ${feed.pass.id}` : 'a tick'
}

export function handoverText(feed: FeedDef, stage: number | null): string {
  const to = stage === null ? feed.to : `stage ${stage}`
  const when = feed.run === 'now' ? 'runs it at once' : 'at its next tick'
  return `Hands ${to} ${feedWhat(feed)} · ${when}`
}
