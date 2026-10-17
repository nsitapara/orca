import type { ListedRun } from './api-types'
import type { LimitSuggestion } from './capacity/limit-suggestion'

// A running run on the Running page. Memory is the summed RSS of its processes on this machine (Docker
// containers aren't counted); null until it has been sampled, or where processes can't be read.
export type CapacityRun = {
  id: string
  automationId: string
  automationName: string
  itemLabel: string
  startedAt: number
  memoryBytes: number | null
  peakBytes: number | null
  // False for a job without an agent step: it never waits for a slot and holds none.
  counted: boolean
}

// An item waiting for a slot, oldest first; its place in line is its index.
export type QueuedRun = {
  automationId: string
  automationName: string
  itemKey: string
  itemLabel: string
  queuedAt: number
  byHand: boolean
}

// An ended run of a job that holds a slot, as Activity lists it; queuedAt on it says when it joined the line.
export type FinishedRun = ListedRun & { automationName: string; peakBytes: number | null }

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
}
