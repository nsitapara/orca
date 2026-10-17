import type { JobDef } from './definition/types'
import type { StageHandovers, TickHandover, TickHandoverFacts } from './api-types-handover'
import type { RunEnv } from './api-types-env'
import type { StoredResult } from './api-types-result'
import type { ActivityRun } from './api-types-runs'
import type { ChainPart } from './run-views/chain'
import type { DetailsRef } from './details'
import type { InboxPreparation, PreparationRef } from './preparation'

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
  // True where Orca's own automation engine is stopped (desktop and serve Pilot, unless
  // PILOT_ORCA_AUTOMATIONS=on). orcad keeps Orca's engine, so it reports false.
  orcaAutomationsOff: boolean
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
  // A dry run of an env automation: where a real run would work (main/envs/preview.ts). Not stored apart; its words are
  // in reason.
  workspace?: string
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
  status: 'running' | 'ok' | 'failed'
  error: string | null
  counts: Partial<Record<Verdict, number>>
  // What the tick warned about (an id its source couldn't read). Absent: none.
  warnings?: string[]
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
// card, or an import (the old sweeps' state, or the vault cards imported once on 2026-10-12).
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
  // Env runs only (workspace: { env }): the item's worktree, and what pilotcli made. Null: not an env run.
  homePath?: string | null
  env?: RunEnv | null
  // When Nish acknowledged it in Done for you (Run visibility); null or absent: not yet.
  acknowledgedAt?: number | null
}
export type StepStatus =
  | 'pending'
  | 'starting'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'stopped'
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
  // A shell step's pilotcli result: the one envelope its whole stdout was, or null.
  result: StoredResult | null
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
// it was given: the page, `pilot inbox answer`, or the vault import of 2026-10-12.
export type InboxAnswer = {
  option: number | null
  text: string | null
  digest: string
  via: 'page' | 'device' | 'cli' | 'import'
  // Who gave it, as the transport stamped it (never from params). Absent on imported answers.
  callerKind?: 'local-cli' | 'desktop' | 'paired-device'
}
// A line under a card and who wrote it, set by the code path that writes it (never read from its words):
// 'pilot' for Pilot's own re-asks and hand-backs, 'agent' for anything an agent or caller said.
export type InboxReply = { text: string; by: 'pilot' | 'agent' }

export type InboxItemRow = {
  preparation?: InboxPreparation | null
  // A "Not prepared" notice (D2): the preparation key of the card it stands in for.
  notPreparedKey?: string | null
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
  // The card's Details bundle (its path and SHA-256, part of the digest); the snapshot is read by id.
  details: DetailsRef | null
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
  // How the work an answer started ended, and what was said back under the card (contract §10, G6).
  outcome: string | null
  replies: InboxReply[]
  // Named parts of a card that can be approved or left out one by one (`approve except:` / `keep:`).
  parts: Record<string, string>
  // The two labels of a card's on/off switch (on first), empty when it has none.
  switchWords: string[]
  source: 'engine' | 'import'
  vaultRef: string | null
  // Only on the inbox list: what the card's item is called (its run's or tick's label, or the Details MR row).
  itemLabel?: string
}
// A card as the Inbox list carries it (Ruling 2): a light preparation ref, and Details without the artifact manifest.
// The full card is pilot.inbox.get (`pilot inbox show`); the manifest comes with pilot.inbox.details.
export type InboxListRow = Omit<InboxItemRow, 'preparation'> & {
  preparation?: PreparationRef | null
  // R-P5: a push, Post or drafted card that was never prepared (imported, or stored by an older build). Nothing
  // runs from it; a person's Prepare evidence queues it for job 14.
  needsEvidence?: boolean
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
export type { ActionPhase, ActionRunRow, ActionRunStatus } from './api-types-actions'
export type { StoredResult } from './api-types-result'

export type TickResult = {
  // null: a dry run, which stores nothing.
  tickId: number | null
  status: 'ok' | 'failed'
  error: string | null
  decisions: ItemDecision[]
  // Source truncation, field scripts that failed: the tick still decided. Logged, not stored.
  // runTick always sets it; optional so existing TickOutcome literals (UI and CLI fixtures) stay valid.
  warnings?: string[]
  handover?: TickHandover
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
  // The newest tick (dry runs aren't ticks: they're stored nowhere).
  lastTick: TickRow | null
  // Its stage of a job of several automations (job: block); null: a job of its own.
  job: JobDef | null
  // Its parts in run order (chainOf), for the list's strip and the rail.
  chain: ChainPart[]
  // Its runs still going or waiting on a person, with their steps: the list's lit chips.
  live: ActivityRun[]
}
export type AutomationListPayload = {
  automations: AutomationSummary[]
  errors: { file: string; errors: string[] }[]
  // Valid files with a notice that changes nothing they do (a feeds arrow that can't be drawn).
  warnings?: { file: string; warnings: string[] }[]
  peopleError: string | null
  missingDirs: string[]
}
export type ActivityTick = TickRow &
  TickHandoverFacts & { items: TickItemRow[]; runs: ActivityRun[] }
export type AutomationDetailPayload = StageHandovers & {
  summary: AutomationSummary
  yaml: string
  checkNames: string[]
}

// The agent ↔ engine channel (pilot run output | event). Step outputs are template fields
// (steps.<step>.<name>), so their values are field values.
export type RunOutputParams = { runId: string; stepIdx: number; outputs: ItemFields }
export type RunOutputResult = { runId: string; stepIdx: number; outputs: ItemFields }
export type RunEventParams = { runId: string; kind: string; payload?: Record<string, unknown> }
export type RunEventResult = { id: number }
// What the CLI sends: the terminal it runs in (ORCA_TERMINAL_HANDLE) names the step starting or running
// on it; runId/stepIdx (PILOT_RUN_ID/PILOT_STEP_IDX) are only the fallback when no step is bound there.
export type RunChannelTarget = { terminal?: string; runId?: string; stepIdx?: number }
export type RunOutputRequest = RunChannelTarget & { outputs: ItemFields }
export type RunEventRequest = RunChannelTarget & { kind: string; payload?: Record<string, unknown> }

export type {
  InboxAddParams,
  InboxAddResult,
  InboxAnswerParams,
  InboxItemSummary,
  InboxListParams,
  InboxListPayload
} from './inbox-types'
export * from './api-types-spend'
export * from './api-types-timeline'
export * from './api-types-import'
export * from './api-types-handover'
export * from './api-types-runs'
