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
export type ActivityPayload = { live: ListedRun[]; ticks: ActivityTick[]; loose: ListedRun[] }
// pilot.runs.get: one run and everything its panel shows. paintRun(detail.chain, detail) paints all of it.
export type RunDetail = {
  run: ListedRun
  automationName: string
  // The automation's chain from its loaded YAML; [] when no file defines it any more.
  chain: ChainPart[]
  tickItem: TickItemRow | null
  trigger: TickTrigger | null
  handovers: HandoverRow[]
  answerRuns: RunRow[]
}
