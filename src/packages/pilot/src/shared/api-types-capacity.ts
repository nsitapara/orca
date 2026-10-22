import type { PartState } from './run-views/paint'
import type { HoldReason, ListedRun } from './api-types'
import type { AgentKind } from './definition/types'
import type { LimitSuggestion } from './capacity/limit-suggestion'

// Where a run works, as its env chose at the start: the item's worktree, or a throwaway while work was in flight
// there. reason: pilotcli's words for the choice ("uncommitted changes", "needs its own stack"); null when it gave none.
export type RunPlace = {
  mode: 'in_place' | 'throwaway' | 'kept'
  reason: string | null
  stack: boolean
}

// A result that came back from an outward step: ok, or skipped/refused with pilotcli's reason.
export type HomeStep = { ok: boolean; reason: string | null }

// What an ended run brought home. Each field is absent when the run had no such step: pushed is its git push-branch
// step, mergedBack its hold_home merge back, kept the branch env delete kept a throwaway's unhomed commits on, stuck a
// throwaway that couldn't be removed and holds work nothing else has.
export type RunHome = {
  pushed?: HomeStep
  mergedBack?: HomeStep
  kept?: string
  // A throwaway Pilot can't remove that holds work nothing else has, in env-text.ts strandedLine's words.
  stuck?: string
}

// An agent's quota use in percent; null where it couldn't be read.
export type QuotaUse = { weekly: number | null; session: number | null }

// A run's agent tab on the machine it runs on: the worktree it opened in, and its terminal tab there.
export type RunTab = { worktreePath: string; tabId: string }

// The step a running run is on: what it is called and, for an agent step, the skill and mode it was given.
export type RunStep = {
  name: string
  kind: 'agent' | 'shell'
  skill: string | null
  mode: string | null
}

// A card an answer run applies, with the answer it carries now (its text is what {run.answer} gave the agent).
export type AnsweringCard = { id: string; title: string; answer: string | null }

// A running run on the Running page. Memory is the summed RSS of its processes on this machine (Docker
// containers aren't counted); null until it has been sampled, or where processes can't be read.
export type CapacityRun = {
  id: string
  automationId: string
  automationName: string
  itemLabel: string
  startedAt: number
  // As on its run (RunRow.idleMs): the time it sat ended before Continue run reopened it.
  idleMs?: number
  memoryBytes: number | null
  peakBytes: number | null
  // False for a job without an agent step: it never waits for a slot and holds none.
  counted: boolean
  // Absent for a run without an env, and from older Pilots.
  place?: RunPlace
  // The worktree it is for (homeOf): the item's, not a throwaway it works in. Null for a job-wide run; absent from
  // older Pilots.
  homePath?: string | null
  // The tab of its running agent step, else its newest detached one; absent for a shell step or a step without a
  // pane, and from older Pilots.
  tab?: RunTab
  // The run started from an answer to an inbox card; absent otherwise, and from older Pilots.
  fromAnswer?: true
  // An answer run's cards, in the order they were sent to it; absent on other runs, and from older Pilots.
  answering?: AnsweringCard[]
  // The step it is starting or running; absent between steps, and from older Pilots.
  step?: RunStep
}

// An item in the runner's line, in line order; its place is its index. The hold fields are absent from older Pilots.
export type QueuedRun = {
  automationId: string
  automationName: string
  itemKey: string
  itemLabel: string
  queuedAt: number
  byHand: boolean
  // When it became due; it has waited since then.
  dueAt?: number
  // What dueAt marks, in words ("oldest new commit"); absent from older Pilots.
  dueFrom?: string
  holdCode?: HoldReason
  // Why it waits, in words.
  holdDetail?: string
  // When its current hold on something other than a slot began; absent on a slot waiter and from older Pilots.
  heldAt?: number
  // Go now marked it: the runner's waits pass it over once. Absent otherwise, and from older Pilots.
  goNow?: boolean
}

// An ended run of a job that holds a slot, as Activity lists it; queuedAt on it says when it joined the line.
// onceKey: the failed or stopped run's key it still holds, which Retry frees; absent otherwise, and from older Pilots.
export type FinishedRun = ListedRun & {
  automationName: string
  peakBytes: number | null
  onceKey?: string
  // Absent for a run without an env or outward steps, and from older Pilots.
  place?: RunPlace
  home?: RunHome
}

// What pilot.capacity.retry frees: a job's failed once_per key.
export type RetryKey = { automationId: string; onceKey: string }

// What pilot.capacity.goNow marks: an item waiting in the runner's line.
export type GoNowKey = { automationId: string; itemKey: string }

// A key the runner gave up on after failing past the retry limit; Retry frees it.
export type GaveUpKey = {
  automationId: string
  automationName: string
  onceKey: string
  itemLabel: string
  failures: number
  failedAt: number
  outcome: string | null
}

// The job the suggestion budgets for. Unmeasured: an enabled job that hasn't run since memory was sampled, counted
// at UNMEASURED_JOB_BYTES.
export type HeaviestJob = {
  automationId: string
  automationName: string
  peakBytes: number
  measured: boolean
}

export type CapacityPayload = {
  // Null: no limit.
  limit: number | null
  running: CapacityRun[]
  queued: QueuedRun[]
  // Newest first, at most MAX_FINISHED_RUNS.
  finished: FinishedRun[]
  memory: { totalBytes: number; availableBytes: number } | null
  suggestion: LimitSuggestion
  heaviest: HeaviestJob | null
  // The quota percentages jobs with an agent step wait at; absent from older Pilots.
  quotaCeiling?: { weekly: number; session: number }
  // Each agent's quota use now, from the runner's cached reading; absent from older Pilots.
  quotaUse?: Partial<Record<AgentKind, QuotaUse>>
  // Retries after a failure, and the keys given up on in the last 7 days; absent from older Pilots.
  retryLimit?: number
  gaveUp?: GaveUpKey[]
  // Every fix a throwaway kept that isn't in its worktree yet, oldest first; absent from older Pilots.
  mergeBack?: MergeBackRow[]
}

// A throwaway run's kept branch on its way into its worktree (job 15), as merge-back-state.ts words it; or a throwaway
// Pilot can't remove that holds work nothing kept on a branch (branch null).
export type MergeBackRow = {
  runId: string
  automationName: string
  itemLabel: string
  branch: string | null
  home: string | null
  // When the throwaway went, else the run's end: what Waited counts from.
  since: number
  state: PartState
  detail: string | null
  // The kept_branch job's newest run for it.
  mergeRunId: string | null
}
