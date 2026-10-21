import type {
  HandoverRow,
  InboxItemSummary,
  RunRow,
  RunStatus,
  RunTrigger,
  StepRow,
  StepStatus,
  TickItemRow,
  TickTrigger
} from '../api-types'
import { homeOf, type EnvState } from '../api-types-env'
import type { ActivityRun, MergeBack } from '../api-types-runs'
import { envWhereLine } from '../env-text'
import type { ChainPart } from './chain'
import { hasDrifted, storedStepPart } from './stored-steps'

export type PartState =
  | 'done'
  | 'running'
  | 'asking'
  | 'skipped'
  | 'failed'
  | 'not_reached'
  | 'none'
export type PaintedPart = ChainPart & {
  state: PartState
  // Plain words beside the state: a field's value, a check's reason, what started the run.
  detail: string | null
  step: StepRow | null
  // The open card this part waits on.
  card: InboxItemSummary | null
  // Every card a step left, open or not, defaults too: the run panel shows them under the step.
  cards: InboxItemSummary[]
  // A run this part leads to: the run a handover started, an answer run, the run an answer run answers.
  linkRunId: string | null
}
// One run and what Pilot stored about it. Only `run` is needed: a strip paints from it alone, the run panel adds the rest
// (pilot.runs.get).
export type PaintInput = {
  run: ActivityRun
  tickItem?: TickItemRow | null
  trigger?: TickTrigger | null
  handovers?: readonly HandoverRow[]
  answerRuns?: readonly RunRow[]
  // The handovers whose tick started this run: the run on the other side of a stage-2 run.
  receivedFrom?: readonly HandoverRow[]
  // The kept_branch job's runs for this run's kept branch, and why its item waits (pilot.runs.get).
  mergeBack?: MergeBack | null
}
// drifted: a stored step doesn't match the YAML at its index, so the steps shown are the run's own (spec §1).
export type PaintedRun = { parts: PaintedPart[]; drifted: boolean }

const FIELD_VALUE_MAX = 24
const LIVE: readonly RunStatus[] = ['running', 'asking']
const STEP_STATE: Record<StepStatus, PartState> = {
  pending: 'not_reached',
  starting: 'running',
  running: 'running',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
  stopped: 'done',
  timed_out: 'failed'
}
const RUN_STATE: Record<RunStatus, PartState> = {
  asking: 'asking',
  running: 'running',
  needs_you: 'asking',
  done: 'done',
  failed: 'failed',
  timed_out: 'failed',
  cancelled: 'skipped'
}
const ENV_STATE: Record<EnvState, PartState> = {
  preparing: 'running',
  ready: 'done',
  deferred: 'skipped',
  failed: 'failed',
  removed: 'done',
  stuck: 'done'
}
const STARTED_BY: Record<RunTrigger, string> = {
  schedule: 'On its schedule',
  manual: 'Run now',
  answer: 'An answer',
  ask_first: 'On its schedule',
  import: 'Imported'
}

export function isPainted(p: ChainPart): p is PaintedPart {
  return 'state' in p
}

function painted(
  p: ChainPart,
  state: PartState,
  detail: string | null = null,
  extra: Partial<Pick<PaintedPart, 'step' | 'card' | 'cards' | 'linkRunId'>> = {}
): PaintedPart {
  return { ...p, state, detail, step: null, card: null, cards: [], linkRunId: null, ...extra }
}

function isLive(run: RunRow): boolean {
  return LIVE.includes(run.status)
}

// Nish said no on its ask-first card: nothing after the ask ran.
export function askSkipped(run: Pick<ActivityRun, 'trigger' | 'status' | 'steps'>): boolean {
  return run.trigger === 'ask_first' && run.status === 'cancelled' && run.steps.length === 0
}

function startedBy(run: RunRow, trigger: TickTrigger | null): string {
  if (!trigger) {
    return STARTED_BY[run.trigger]
  }
  const from = trigger.stage === null ? trigger.automationId : `stage ${trigger.stage}`
  return `Handed over by ${from}: ${trigger.ids.join(', ')}`
}

function fieldValue(p: ChainPart, item: TickItemRow | null): string | null {
  const key = p.gives[0]
  if (!item || !key || !Object.hasOwn(item.fields, key)) {
    return null
  }
  const value = String(item.fields[key])
  // A field can hold a line of card text (09's card_context): only a short, one-line value shows.
  if (value.length > FIELD_VALUE_MAX || value.includes('\n')) {
    return null
  }
  return `${p.name} = ${value}`
}

function paintChecks(p: ChainPart, item: TickItemRow | null): PaintedPart {
  const found = (item?.checks ?? []).filter((c) => p.checks.includes(c.check))
  const failed = found.find((c) => !c.ok)
  if (failed) {
    return painted(p, 'failed', failed.reason)
  }
  const reasons = found.map((c) => c.reason).filter((r) => r !== '')
  return painted(p, 'done', reasons.length > 0 ? reasons.join(' · ') : null)
}

function paintAsk(p: ChainPart, run: ActivityRun): PaintedPart {
  if (run.trigger !== 'ask_first') {
    return painted(p, 'none')
  }
  if (run.status === 'asking') {
    const card = run.inbox.find((i) => i.status === 'open' && i.stepIdx === null) ?? null
    return painted(p, 'asking', null, { card })
  }
  if (askSkipped(run)) {
    return painted(p, 'skipped', run.outcome)
  }
  return painted(p, 'done')
}

function paintWorkspace(p: ChainPart, run: ActivityRun): PaintedPart {
  if (run.trigger === 'import') {
    return painted(p, 'none')
  }
  if (run.status === 'asking' || askSkipped(run)) {
    return painted(p, 'not_reached')
  }
  if (run.env) {
    return painted(p, ENV_STATE[run.env.state], envWhereLine(run.env))
  }
  if (run.steps.length === 0 && !isLive(run)) {
    return painted(p, 'failed', run.outcome)
  }
  return painted(p, 'done', homeOf(run))
}

// Before any step: from the run's tick and tick item. A run no tick started (an answer, an import) has none of them.
function paintBefore(p: ChainPart, input: PaintInput): PaintedPart {
  const { run } = input
  if (p.kind === 'ask') {
    return paintAsk(p, run)
  }
  if (p.kind === 'workspace') {
    return paintWorkspace(p, run)
  }
  if (run.tickId === null) {
    return painted(p, 'none')
  }
  if (p.kind === 'starts') {
    const from = input.receivedFrom?.[0]?.senderRunId ?? null
    return painted(p, 'done', startedBy(run, input.trigger ?? null), { linkRunId: from })
  }
  if (p.kind === 'field') {
    return painted(p, 'done', fieldValue(p, input.tickItem ?? null))
  }
  if (p.kind === 'gates' || p.kind === 'check') {
    return paintChecks(p, input.tickItem ?? null)
  }
  return painted(p, 'done')
}

// A step's row at its index (steps are written as they're reached: no row yet is not reached), with the cards it left.
// A card never holds a step: a finished run with an open card waits on its person (needs_you), so the step shows as it
// ran and `card` names the open one (a default the agent took never holds the run: openCountForRun).
function paintStep(p: ChainPart, run: ActivityRun): PaintedPart {
  const step = run.steps.find((s) => s.idx === p.stepIdx) ?? null
  const cards = run.inbox.filter((i) => i.stepIdx === p.stepIdx)
  const card = cards.find((i) => i.status === 'open' && i.type !== 'default') ?? null
  if (!step) {
    return painted(p, card ? 'asking' : 'not_reached', null, { card, cards })
  }
  return painted(
    p,
    STEP_STATE[step.status],
    step.status === 'stopped' ? 'Stopped the run here' : null,
    { step, card, cards }
  )
}

function paintAnswers(p: ChainPart, input: PaintInput): PaintedPart {
  const child = input.answerRuns?.[0] ?? null
  if (child) {
    return painted(p, isLive(child) ? 'running' : 'done', `Answer run ${child.id}`, {
      linkRunId: child.id
    })
  }
  // A step's card answered (an ask-first card has no step: its answer is the Asks you row's).
  const answered = input.run.inbox.some(
    (i) => i.stepIdx !== null && (i.status === 'answered' || i.status === 'done')
  )
  return painted(p, answered ? 'done' : 'none')
}

function paintHandover(p: ChainPart, input: PaintInput): PaintedPart {
  const rows = (input.handovers ?? []).filter((h) => h.receiverId === p.to)
  if (rows.length > 0) {
    const started = rows.find((h) => h.runId !== null)?.runId ?? null
    const said = rows.map((h) => `${h.itemId} → ${h.verdict ?? h.state}`).join(' · ')
    return painted(p, 'done', said, { linkRunId: started })
  }
  return painted(p, isLive(input.run) ? 'not_reached' : 'none')
}

// Merge back: from the throwaway's env (what env delete kept) and the kept_branch job's runs for that branch.
function paintMergeBack(p: ChainPart, input: PaintInput): PaintedPart {
  const { run } = input
  const env = run.env
  if (env?.mode !== 'throwaway') {
    return painted(p, 'none')
  }
  if (isLive(run)) {
    return painted(p, 'not_reached')
  }
  if (env.removedAt === null) {
    return painted(p, 'running', 'Removing the throwaway')
  }
  if (!env.kept) {
    return painted(
      p,
      'skipped',
      'Nothing to merge back: its commits reached your worktree or origin'
    )
  }
  const last = input.mergeBack?.runs[0] ?? null
  const link = { linkRunId: last?.id ?? null }
  if (last && isLive(last)) {
    return painted(p, 'running', `Merging ${env.kept}`, link)
  }
  if (last?.status === 'done') {
    return painted(p, 'done', `Merged ${env.kept} into your worktree`, link)
  }
  if (last?.status === 'needs_you') {
    return painted(p, 'asking', `Merging ${env.kept} needs you`, link)
  }
  const waiting = input.mergeBack?.waiting
  if (waiting) {
    return painted(p, 'not_reached', `Waiting in line: ${waiting}`, link)
  }
  if (last) {
    return painted(p, 'failed', last.outcome ?? `Merging ${env.kept} failed`, link)
  }
  return painted(p, 'not_reached', `Kept on ${env.kept}; queued for merge back`)
}

function paintAfter(p: ChainPart, input: PaintInput): PaintedPart {
  if (p.kind === 'answers') {
    return paintAnswers(p, input)
  }
  if (p.kind === 'merge_back') {
    return paintMergeBack(p, input)
  }
  return paintHandover(p, input)
}

// An answer run (trigger answer, no tick): nothing before any step applies; its own steps sit under Answers, which
// links the run it answers.
function answerRunParts(chain: readonly ChainPart[], input: PaintInput): PaintedPart[] {
  const { run } = input
  return [
    ...chain.filter((p) => p.group === 'before').map((p) => painted(p, 'none')),
    ...run.steps.map((s) => paintStep(storedStepPart(s, 'answer'), run)),
    ...chain
      .filter((p) => p.kind === 'answers')
      .map((p) => painted(p, RUN_STATE[run.status], null, { linkRunId: run.parentRunId })),
    ...chain
      .filter((p) => p.group === 'after')
      .map((p) => (p.kind === 'merge_back' ? paintMergeBack(p, input) : painted(p, 'none')))
  ]
}

// Each part of the chain in this run's state (spec §1, "Painting one run"). Nothing is stored: every state comes from
// rows Pilot already keeps.
export function paintRun(chain: readonly ChainPart[], input: PaintInput): PaintedRun {
  const { run } = input
  if (run.trigger === 'answer') {
    return { parts: answerRunParts(chain, input), drifted: false }
  }
  // An import run's step is Pilot's own `imported`, never the YAML's: its stored steps show and nothing has drifted.
  const imported = run.trigger === 'import'
  const drifted = !imported && hasDrifted(chain, run.steps)
  const steps =
    drifted || imported
      ? run.steps.map((s) => storedStepPart(s, 'step'))
      : chain.filter((p) => p.kind === 'step')
  return {
    parts: [
      ...chain.filter((p) => p.group === 'before').map((p) => paintBefore(p, input)),
      ...steps.map((p) => paintStep(p, run)),
      ...chain
        .filter((p) => p.group === 'asks' || p.group === 'after')
        .map((p) => paintAfter(p, input))
    ],
    drifted
  }
}
