export type PilotStatus = {
  version: string
  process: 'main' | 'orcad'
  dataPath: string
  automationDirs: string[]
  missingDirs: string[]
  // A people.yaml problem or notice (e.g. people.yaml and people.yml both exist). Never blocks loading.
  peopleError: string | null
  // Why Pilot couldn't start (store won't open, …); null while it runs. Orca itself keeps running.
  error: string | null
  // When the scheduler's current pass started and when the last one finished (Unix ms). A
  // loopStartedAt far in the past with no later lastLoopFinishedAt means a pass is stuck. Both null
  // without a scheduler (Pilot failed to start, or the scheduler is off in this process).
  loopStartedAt: number | null
  lastLoopFinishedAt: number | null
}

export type FieldValue = string | number | boolean | null
export type ItemFields = Record<string, FieldValue>

export type Verdict = 'started' | 'skipped' | 'notdue' | 'out_of_scope' | 'over_limit' | 'baselined'
export type CheckOutcome = { check: string; ok: boolean; reason: string }
export type TickItem = { key: string; label: string; fields: ItemFields }
export type ItemDecision = {
  key: string
  label: string
  verdict: Verdict
  reason: string
  checks: CheckOutcome[]
  onceKey: string
  fields: ItemFields
}

export type TickRow = {
  id: number
  automationId: string
  startedAt: number
  finishedAt: number | null
  dryRun: boolean
  status: 'running' | 'ok' | 'failed'
  error: string | null
  counts: Partial<Record<Verdict, number>>
}
export type TickItemRow = {
  tickId: number
  itemKey: string
  label: string
  verdict: Verdict
  reason: string
  checks: CheckOutcome[]
  fields: ItemFields
  runId: string | null
}
export type RunStatus =
  | 'asking'
  | 'running'
  | 'needs_you'
  | 'done'
  | 'failed'
  | 'timed_out'
  | 'cancelled'
// What started a run (contract §9): the schedule, Run now, a saved answer, a yes to an ask-first
// card, or the one-shot vault import.
export type RunTrigger = 'schedule' | 'manual' | 'answer' | 'ask_first' | 'import'
export type RunRow = {
  id: string
  automationId: string
  tickId: number | null
  itemKey: string
  itemLabel: string
  worktreePath: string | null
  status: RunStatus
  outcome: string | null
  startedAt: number
  finishedAt: number | null
  costUsd: number | null
  tokens: number | null
  worktreeId: string | null
  trigger: RunTrigger
  parentRunId: string | null
  imported: boolean
}
export type StepStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'timed_out'
export type StepKind = 'agent' | 'shell'
export type StepRow = {
  runId: string
  idx: number
  name: string
  agent: string
  skill: string | null
  status: StepStatus
  terminalHandle: string | null
  paneKey: string | null
  sessionId: string | null
  transcriptPath: string | null
  costUsd: number | null
  tokens: number | null
  startedAt: number | null
  finishedAt: number | null
  error: string | null
  kind: StepKind
  mode: string | null
  model: string | null
  // What the step reported (`pilot run output`, `::pilot-output` lines; contract §7).
  outputs: ItemFields
  whenExpr: string | null
  exitCode: number | null
  outputTail: string | null
  sessionPinned: boolean
}
// The run holding a once_per key settles it: done, or failed (retry_after_failure waits from failedAt).
export type HandledStatus = 'started' | 'done' | 'failed'
export type HandledRow = {
  onceKey: string
  runId: string | null
  at: number
  status: HandledStatus
  failedAt: number | null
}

export type TickResult = {
  tickId: number
  status: 'ok' | 'failed'
  error: string | null
  decisions: ItemDecision[]
}

// What dryRun and tickNow return: a result, or why there isn't one.
export type TickOutcome = TickResult | { status: 'busy' } | { status: 'unknown' }

export type AutomationSummary = {
  id: string
  name: string
  file: string
  enabled: boolean
  schedule: string
  timezone: string
  itemKind: string
  agent: string
  // Read from the file but not enforced in M1: the Overview says so.
  powers: string[]
  inbox: string
  // From the scheduler's cache; null for `schedule: manual` and for a disabled automation.
  nextTickAt: number | null
  // The newest tick of either kind; its dryRun says which.
  lastTick: TickRow | null
}
export type AutomationListPayload = {
  automations: AutomationSummary[]
  errors: { file: string; errors: string[] }[]
  peopleError: string | null
  missingDirs: string[]
}
export type ActivityTick = TickRow & {
  items: TickItemRow[]
  runs: (RunRow & { steps: StepRow[] })[]
}
export type AutomationDetailPayload = {
  summary: AutomationSummary
  yaml: string
  checkNames: string[]
}
