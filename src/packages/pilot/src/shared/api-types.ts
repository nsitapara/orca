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

export type Verdict =
  | 'started'
  | 'skipped'
  | 'notdue'
  | 'out_of_scope'
  | 'over_limit'
  | 'baselined'
  | 'asked'
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

// An item source's verdict on one item's where clauses (contract §3), before once_per and checks.
export type ScopeResult =
  | { ok: true }
  | { ok: false; verdict: 'out_of_scope' | 'notdue'; reason: string }

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
  // What the step reported (`pilot run output`, a shell step's $PILOT_OUTPUT_FILE; contract §7).
  outputs: ItemFields
  whenExpr: string | null
  exitCode: number | null
  outputTail: string | null
  sessionPinned: boolean
  // The args the step's agent process runs under (its own launch, or the process it was sent into);
  // null when not known. Session flags (--session-id, --resume) are not included.
  launchArgs: string[] | null
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

export type InboxType = 'question' | 'flagged' | 'default' | 'action' | 'bug' | 'left_for_you'
export type InboxStatus = 'open' | 'answered' | 'done' | 'obsolete' | 'stale' | 'dismissed'
export type InboxOption = { label: string; meaning: string }
// An answer carries the digest of the card version it was given against (contract §10), and where
// it was given: the page, `pilot inbox answer`, or the vault import.
export type InboxAnswer = {
  option: number | null
  text: string | null
  digest: string
  via: 'page' | 'cli' | 'import'
}
export type InboxItemRow = {
  id: string
  automationId: string
  runId: string | null
  stepIdx: number | null
  itemKey: string | null
  worktreePath: string | null
  person: string
  type: InboxType
  title: string
  context: string
  options: InboxOption[]
  suggested: string | null
  detailsMd: string | null
  action: string | null
  actionArgs: Record<string, unknown> | null
  digest: string
  version: number
  status: InboxStatus
  answer: InboxAnswer | null
  answeredAt: number | null
  answeredBy: string | null
  createdAt: number
  updatedAt: number
  // How the work an answer started ended, and what the agent said back (contract §10, G6).
  outcome: string | null
  replies: string[]
  // Named parts of a card that can be approved or left out one by one (`approve except:` / `keep:`).
  parts: Record<string, string>
  // The two labels of a card's on/off switch (on first), empty when it has none.
  switchWords: string[]
  source: 'engine' | 'import'
  vaultRef: string | null
}
export type QueueState = 'not_ready' | 'ready' | 'held' | 'dispatched' | 'failed'
export type HoldReason =
  | 'worktree_busy'
  | 'typing'
  | 'claimed'
  | 'quota'
  | 'no_worktree'
  | 'mr_unknown'
  | 'in_flight'
  | 'waits'
  | 'retry'
export type QueueRoute = 'resume' | 'fork' | 'new' | 'action'
export type QueueRow = {
  id: number
  inboxItemId: string
  state: QueueState
  holdReason: HoldReason | null
  // The words that go with the code, shown on the page ("Nish is typing in the terminal").
  holdDetail: string | null
  readyAt: number
  attempts: number
  route: QueueRoute | null
  targetSessionId: string | null
  dispatchedRunId: string | null
  updatedAt: number
}

export type EventRow = {
  id: number
  at: number
  automationId: string | null
  runId: string | null
  worktreePath: string | null
  itemKey: string | null
  kind: string
  payload: Record<string, unknown>
}
export type ActionPhase = 'check' | 'ready' | 'do' | 'refresh'
// act.py's outcome words are first-class statuses (R-4); 'refused' is an attempt the engine turned away.
export type ActionRunStatus =
  | 'running'
  | 'done'
  | 'failed'
  | 'stale'
  | 'needs_agent'
  | 'not_yet'
  | 'refused'
export type ActionRunRow = {
  id: number
  inboxItemId: string | null
  runId: string | null
  action: string
  args: Record<string, unknown>
  digest: string
  phase: ActionPhase
  status: ActionRunStatus
  output: string | null
  dryRun: boolean
  startedAt: number
  finishedAt: number | null
}

export type TickResult = {
  tickId: number
  status: 'ok' | 'failed'
  error: string | null
  decisions: ItemDecision[]
  // Source truncation, field scripts that failed: the tick still decided. Logged, not stored.
  // runTick always sets it; optional so existing TickOutcome literals (UI and CLI fixtures) stay valid.
  warnings?: string[]
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
