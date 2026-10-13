import type { FieldValue, RunRow, StepRow, TickTrigger } from '../../shared/api-types'
import type { AutomationDefinition, FeedDef } from '../../shared/definition/types'
import type { RunEnd } from '../../shared/run/step-plan'
import { MAX_IDS, usableId } from '../sources/ids-from'
import type { PilotStore } from '../store/store'

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

function handOverFeed(
  deps: HandOverDeps,
  def: AutomationDefinition & { job: NonNullable<AutomationDefinition['job']> },
  run: RunRow,
  feed: FeedDef,
  steps: () => StepRow[]
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
    deps.store.handovers.add({
      senderId: def.id,
      senderRunId: run.id,
      receiverId: feed.to,
      itemIds: ids,
      at: deps.now()
    })
  }
  if (feed.run === 'now') {
    deps.trigger?.(feed.to, { automationId: def.id, runId: run.id, stage: def.job.stage, ids })
  }
}

// A stage's run ended (closeRun's onRunEnd): each feed whose `when` holds hands the receiving stage the ids in its
// passed output, durably and once per (run, receiver, id), then asks for the receiver's tick when it runs now. A feed
// with pass that found no id triggers nothing. Never throws: a failure is logged, and the run's end stands.
export function handOverRunEnd(deps: HandOverDeps, run: RunRow, end: RunEnd): void {
  try {
    if (!HANDS_OVER.has(run.trigger)) {
      return
    }
    const def = deps.definitionFor(run.automationId)
    if (!def?.job) {
      return
    }
    const staged = { ...def, job: def.job }
    let steps: StepRow[] | null = null
    const stepsOnce = (): StepRow[] => {
      steps ??= deps.store.runs.steps(run.id)
      return steps
    }
    for (const feed of def.job.feeds) {
      if ((feed.pass !== null || feed.run === 'now') && feedFires(feed, end)) {
        handOverFeed(deps, staged, run, feed, stepsOnce)
      }
    }
  } catch (error) {
    deps.log(`[pilot] run ${run.id}: couldn't hand over to the next stage: ${messageOf(error)}`)
  }
}
