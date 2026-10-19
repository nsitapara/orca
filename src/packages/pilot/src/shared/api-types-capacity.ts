import type { HoldReason, ListedRun } from './api-types'
import type { LimitSuggestion } from './capacity/limit-suggestion'

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
}

// An ended run of a job that holds a slot, as Activity lists it; queuedAt on it says when it joined the line.
// onceKey: the failed key the run still holds, which Retry frees; absent otherwise, and from older Pilots.
export type FinishedRun = ListedRun & {
  automationName: string
  peakBytes: number | null
  onceKey?: string
}

// What pilot.capacity.retry frees: a job's failed once_per key.
export type RetryKey = { automationId: string; onceKey: string }

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
  // Retries after a failure, and the keys given up on in the last 7 days; absent from older Pilots.
  retryLimit?: number
  gaveUp?: GaveUpKey[]
}
