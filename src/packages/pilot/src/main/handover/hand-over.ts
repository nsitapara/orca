import type { FieldValue, RunRow, StepRow, TickTrigger } from '../../shared/api-types'
import type { AutomationDefinition, FeedDef } from '../../shared/definition/types'
import type { RunEnd } from '../../shared/run/step-plan'
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

// The output as the run reported it: the value of the last step (by index) that reported it.
export function runOutput(steps: readonly StepRow[], name: string): FieldValue | undefined {
  const reported = steps.filter((s) => Object.hasOwn(s.outputs, name)).sort((a, b) => b.idx - a.idx)
  return reported[0]?.outputs[name]
}

type Plan = HandoverWrite & { rows: NewHandover[] }

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
    const output = feed.pass.id
    const read = idsInOutput(runOutput(steps(), output))
    for (const word of read.refused) {
      deps.log(
        `[pilot] run ${run.id}: ${output}: ${JSON.stringify(word)} is not an id; not handed over`
      )
    }
    ids = read.ids
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
  const planned: Plan = { rows: [], triggers: [], note: null }
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
    return { rows: [], triggers: [], note: null }
  }
  return planned
}

// closeRun's handover (run-close.ts): `write` inside the transaction that ends the run writes each id durably, once
// per (run, receiver, id), and throws when the store does, so the run's end rolls back with it; `after` asks for the
// receivers' ticks (run: now) once that committed.
export function runEndHandover(deps: HandOverDeps): RunEndHandover {
  return {
    write(run, end) {
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
