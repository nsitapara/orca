import type { FieldValue, RunRow, StepRow, TickTrigger } from '../../shared/api-types'
import type { AutomationDefinition, FeedDef } from '../../shared/definition/types'
import type { RunEnd } from '../../shared/run/step-plan'
import { fedIdProblem, MAX_FED_IDS_PER_RUN } from '../../shared/definition/item-ids'
import type { HandoverWrite, RunEndHandover } from '../run/run-close'
import { MAX_IDS, usableId } from '../sources/ids-from'
import type { PilotStore } from '../store/store'
import type { NewHandover } from '../store/store-handovers'

export type HandOverDeps = {
  store: PilotStore
  now(): number
  definitionFor(automationId: string): AutomationDefinition | null
  // A feed's run: now: a tick of the receiving stage as soon as this run ends. Absent: nothing is triggered.
  trigger?(receiverId: string, cause: TickTrigger): void
  log(message: string): void
}

// Runs that ran the stage's steps. An answer run applies an answer, and an imported run ran elsewhere: neither hands
// anything over.
const HANDS_OVER: ReadonlySet<RunRow['trigger']> = new Set(['schedule', 'manual', 'ask_first'])

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// when: success is a run whose steps did their work: done, or done with cards waiting on you. always: any end.
export function feedFires(feed: FeedDef, end: RunEnd): boolean {
  if (feed.when === 'always') {
    return true
  }
  return end.status === 'done' || end.status === 'needs_you'
}

// The ids in an output's value: one id, or several separated by commas or spaces, each once, at most MAX_IDS. A whole
// number is its digits. Anything else (true, null, an id with a control character) is refused.
export function idsInOutput(value: FieldValue | undefined): { ids: string[]; refused: string[] } {
  if (value === undefined || value === null || value === '') {
    return { ids: [], refused: [] }
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return { ids: [String(value)], refused: [] }
  }
  if (typeof value !== 'string') {
    return { ids: [], refused: [String(value)] }
  }
  const words = value.split(/[\s,]+/).filter((w) => w !== '')
  const ids = [...new Set(words.filter(usableId))].slice(0, MAX_IDS)
  return { ids, refused: words.filter((w) => !usableId(w)) }
}

// The output as the run reported it: the value of the last step (by index) that declares it in outputs: and reported
// it. Another step's key of the same name is never read; an agent step's only when the feed says trust: agent.
export function runOutput(
  steps: readonly StepRow[],
  name: string,
  def: AutomationDefinition,
  trust: FeedDef['trust']
): FieldValue | undefined {
  const declares = (idx: number): boolean => {
    const step = def.steps[idx]
    return (
      step !== undefined &&
      step.outputs.includes(name) &&
      (step.agent === 'shell' || trust === 'agent')
    )
  }
  const reported = steps
    .filter((s) => declares(s.idx) && Object.hasOwn(s.outputs, name))
    .sort((a, b) => b.idx - a.idx)
  return reported[0]?.outputs[name]
}

type Plan = HandoverWrite & { rows: NewHandover[]; refused: string[] }

// The ids the receiving stage can read, and why each other one is refused: its item kind's id format (WEB-123 for
// Linear tickets) and at most MAX_FED_IDS_PER_RUN ids a run.
function screen(deps: HandOverDeps, to: string, words: readonly string[]) {
  const kind = deps.definitionFor(to)?.items?.kind ?? null
  const ok: string[] = []
  const refused = new Map<string, string[]>()
  const refuse = (id: string, why: string) => refused.set(why, [...(refused.get(why) ?? []), id])
  for (const id of words) {
    const problem = fedIdProblem(kind, id)
    if (problem) {
      refuse(id, problem)
    } else if (ok.length >= MAX_FED_IDS_PER_RUN) {
      refuse(id, `past ${MAX_FED_IDS_PER_RUN} ids in one run`)
    } else {
      ok.push(id)
    }
  }
  const quoted = (ids: string[]) => ids.map((id) => JSON.stringify(id)).join(', ')
  const why = [...refused].map(([reason, ids]) => `${quoted(ids)} (${reason})`)
  return { ok, note: why.length > 0 ? `handover to ${to} refused ${why.join(', ')}` : null }
}

// What one feed hands over and asks for. A feed with pass that found no id triggers nothing.
function planFeed(
  deps: HandOverDeps,
  def: AutomationDefinition & { job: NonNullable<AutomationDefinition['job']> },
  run: RunRow,
  feed: FeedDef,
  steps: () => StepRow[],
  plan: Plan
): void {
  let ids: string[] = []
  if (feed.pass !== null) {
    const read = idsInOutput(runOutput(steps(), feed.pass.id, def, feed.trust))
    const screened = screen(deps, feed.to, [...read.ids, ...read.refused])
    if (screened.note) {
      plan.refused.push(screened.note)
    }
    ids = screened.ok
    if (ids.length === 0) {
      return
    }
    plan.rows.push({
      senderId: def.id,
      senderRunId: run.id,
      receiverId: feed.to,
      itemIds: ids,
      at: deps.now()
    })
  }
  if (feed.run === 'now') {
    plan.triggers.push({
      to: feed.to,
      cause: { automationId: def.id, runId: run.id, stage: def.job.stage, ids }
    })
  }
}

// What a stage's run hands over at its end: each feed whose `when` holds, with pass or run: now. A planning failure
// (a definition or step read) is logged and hands nothing over; the run's end stands.
function plan(deps: HandOverDeps, run: RunRow, end: RunEnd): Plan {
  const planned: Plan = { rows: [], triggers: [], note: null, refused: [] }
  try {
    if (!HANDS_OVER.has(run.trigger)) {
      return planned
    }
    const def = deps.definitionFor(run.automationId)
    if (!def?.job) {
      return planned
    }
    const staged = { ...def, job: def.job }
    let steps: StepRow[] | null = null
    const stepsOnce = (): StepRow[] => {
      steps ??= deps.store.runs.steps(run.id)
      return steps
    }
    for (const feed of def.job.feeds) {
      if ((feed.pass !== null || feed.run === 'now') && feedFires(feed, end)) {
        planFeed(deps, staged, run, feed, stepsOnce, planned)
      }
    }
  } catch (error) {
    deps.log(`[pilot] run ${run.id}: couldn't hand over to the next stage: ${messageOf(error)}`)
    return { rows: [], triggers: [], note: null, refused: [] }
  }
  for (const note of planned.refused) {
    deps.log(`[pilot] run ${run.id}: ${note}`)
  }
  return { ...planned, note: planned.refused.length > 0 ? planned.refused.join('; ') : null }
}

// closeRun's handover (run-close.ts): `write` inside the transaction that ends the run puts a failed run's fed ids
// back to pending and writes each id it hands over durably, once per (run, receiver, id); it throws when the store
// does, so the run's end rolls back with it. `after` asks for the receivers' ticks (run: now) once that committed.
export function runEndHandover(deps: HandOverDeps): RunEndHandover {
  return {
    write(run, end) {
      // A run started for a handed-over id that failed: the id is pending again, for retry_after_failure.
      if (end.status === 'failed' || end.status === 'timed_out') {
        deps.store.handovers.reopen(run.id)
      }
      const planned = plan(deps, run, end)
      for (const row of planned.rows) {
        deps.store.handovers.add(row)
      }
      return { note: planned.note, triggers: planned.triggers }
    },
    after(written) {
      for (const { to, cause } of written.triggers) {
        try {
          deps.trigger?.(to, cause)
        } catch (error) {
          deps.log(
            `[pilot] run ${cause.runId}: couldn't trigger ${to}: ${messageOf(error)}; its ids stay pending`
          )
        }
      }
    }
  }
}

// The handover of a run that already ended, outside closeRun (tests, parity): written in its own transaction, then
// its triggers.
export function handOverRunEnd(deps: HandOverDeps, run: RunRow, end: RunEnd): void {
  const handover = runEndHandover(deps)
  handover.after(deps.store.transaction(() => handover.write(run, end)))
}
