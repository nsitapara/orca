import type { RunRow, StepRow } from './api-types'
import type { InboxItemSummary } from './inbox-types'

// A run with its steps and what it asked (open and answered cards): Activity's runs, the list's live runs, a card's run.
export type ActivityRun = RunRow & { steps: StepRow[]; inbox: InboxItemSummary[] }
