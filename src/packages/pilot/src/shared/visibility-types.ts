import type { ListedRun } from './api-types-runs'
import type { InboxItemSummary } from './inbox-types'

// One line of a step's condensed log (Run visibility spec §1): an action with its result folded, or a message the
// agent wrote.
export type LogStatus = 'ok' | 'error' | 'interrupted' | 'pending'
export type LogToolEntry = {
  kind: 'tool'
  id: string
  at: number
  tool: string
  title: string
  status: LogStatus
  summary: string | null
  links: string[]
}
export type LogTextEntry = { kind: 'text'; id: string; at: number; title: string }
export type LogEntry = LogToolEntry | LogTextEntry

// pilot.runs.log: a step's log inside its own window. source 'none' says why there is none in `reason`.
export type StepLog = {
  source: 'claude' | 'none'
  reason: string | null
  entries: LogEntry[]
  // Entries inside the window left out before the first one returned.
  truncatedBefore: number
  // Entries after the window: a resumed session's, not this run's.
  later: number
}
// pilot.runs.logEntry: one entry's full input and output; *Cut counts the leading characters not shown.
export type LogEntryDetail = { input: string; output: string; inputCut: number; outputCut: number }

export type EffectKind =
  | 'pushed'
  | 'mr_opened'
  | 'mr_updated'
  | 'mr_ready'
  | 'mr_commented'
  | 'gitlab_write'
  | 'ticket_created'
  | 'ticket_commented'
  | 'ticket_updated'
  | 'action'
// Something a run changed outside Pilot (spec §2). target: a branch, !N, TEAM-N, a GitLab API path, or a catalog
// action's detail ("created WEB-2179"); null when the transcript didn't say.
export type Effect = {
  kind: EffectKind
  target: string | null
  url: string | null
  count: number
  stepIdx: number | null
  at: number
}
// pilot.runs.effects: each asked-for run's effects, by run id.
export type RunEffects = Record<string, Effect[]>
// pilot.runs.doneForYou: a finished run that changed something or took a default, not acknowledged yet.
export type DoneRun = { run: ListedRun; effects: Effect[]; defaults: InboxItemSummary[] }
