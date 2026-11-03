import { HEADROOM_BYTES, MIN_JOB_BYTES, UNMEASURED_JOB_BYTES } from './limit-suggestion'

// The share of a job's recent peaks its reserve covers: one spike doesn't price every later run of the job.
const RESERVE_PERCENTILE = 0.9

export type JobReserveBytes = { bytes: number; measured: boolean }

// A job's reserve: the 90th percentile (nearest rank) of its recent peaks, or a stack's worth until it's measured.
export function reserveOf(peaks: readonly number[]): JobReserveBytes {
  if (peaks.length === 0) {
    return { bytes: UNMEASURED_JOB_BYTES, measured: false }
  }
  const sorted = [...peaks].sort((a, b) => a - b)
  const rank = Math.ceil(RESERVE_PERCENTILE * sorted.length) - 1
  return { bytes: Math.max(sorted[rank], MIN_JOB_BYTES), measured: true }
}

// A running job's reserve, and what it holds now (null until sampled).
export type HeldMemory = { reserveBytes: number; memoryBytes: number | null }

// What a starting job can have: available now, less what running jobs may still grow into, less the headroom.
// A job past its reserve already shows in available, so it frees nothing.
export function spareBytes(availableBytes: number, running: readonly HeldMemory[]): number {
  const growth = running.reduce(
    (sum, r) => sum + Math.max(0, r.reserveBytes - (r.memoryBytes ?? 0)),
    0
  )
  return availableBytes - growth - HEADROOM_BYTES
}

// A job waits only beside other jobs: alone it always starts, or a reserve past the machine would never run.
export function fitsMemory(reserveBytes: number, spare: number, runningJobs: number): boolean {
  return runningJobs === 0 || reserveBytes <= spare
}
