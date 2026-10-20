import type {
  ActivityTick,
  HandoverRow,
  ItemFields,
  RunRow,
  StepRow,
  TickItemRow,
  TickTrigger
} from './api-types'
import type { InboxItemSummary } from './inbox-types'
import type { ChainPart } from './run-views/chain'

// A run with its steps and what it asked (open and answered cards): Activity's runs, the list's live runs, a card's run.
export type ActivityRun = RunRow & { steps: StepRow[]; inbox: InboxItemSummary[] }

// A run Activity lists outside a tick line (running now, waiting on you, no tick), with its tick item's fields for its
// item link ({} when its tick was pruned or it had none).
export type ListedRun = ActivityRun & { fields: ItemFields }
// pilot.activity.list: live runs of any age, ticks (newest first), and the runs no tick started.
// `reach`: when the page of ticks was full, the moment the list was cut back to (it shows nothing older); else null.
export type ActivityPayload = {
  live: ListedRun[]
  ticks: ActivityTick[]
  loose: ListedRun[]
  reach: number | null
}
// pilot.runs.continue: the step a failed run went on from, and whether that step's agent session was resumed.
export type ContinueRunResult = { step: string; resumed: boolean }
// pilot.runs.stop: the run ended cancelled, or why it wasn't stopped.
export type StopRunResult = { stopped: true } | { stopped: false; reason: string }
// pilot.runs.get: one run and everything its panel shows. paintRun(detail.chain, detail) paints all of it.
export type RunDetail = {
  run: ListedRun
  automationName: string
  // The automation's chain from its loaded YAML; [] when no file defines it any more.
  chain: ChainPart[]
  tickItem: TickItemRow | null
  trigger: TickTrigger | null
  handovers: HandoverRow[]
  // The handovers whose tick started this run (a stage-2 run): the run on the other side.
  receivedFrom: HandoverRow[]
  answerRuns: RunRow[]
}
