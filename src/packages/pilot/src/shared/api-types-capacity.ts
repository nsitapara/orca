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

export type HeaviestJob = { automationId: string; automationName: string; peakBytes: number }

export type CapacityPayload = {
  // Null: no limit.
  limit: number | null
  running: CapacityRun[]
  queued: QueuedRun[]
  memory: { totalBytes: number; availableBytes: number } | null
  suggestion: LimitSuggestion
  heaviest: HeaviestJob | null
}
