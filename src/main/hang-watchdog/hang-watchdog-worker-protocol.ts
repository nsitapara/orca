export const HANG_WATCHDOG_HEARTBEAT_INTERVAL_MS = 2_000
export const HANG_WATCHDOG_TIMEOUT_MS = 45_000
export const HANG_WATCHDOG_CHECK_INTERVAL_MS = 5_000
// Why below the timeout: freezes start as escalating stalls, so the first sample comes earlier.
export const HANG_WATCHDOG_STALL_SAMPLE_MS = 15_000

export type HangWatchdogWorkerData = {
  parentPid: number
  markerPath: string
  timeoutMs: number
  checkIntervalMs: number
  /** Where `/usr/bin/sample` output goes; absent turns stack sampling off. */
  sampleDir?: string
  stallSampleMs?: number
}

export type MainToHangWatchdogWorkerMessage = { type: 'heartbeat' } | { type: 'shutdown' }

// A stall the worker sampled has cleared; main records it while its trace is live again.
export type HangWatchdogWorkerToMainMessage = {
  type: 'stall-sampled'
  unresponsiveMs: number
  hang: boolean
  samplePath?: string
  stallSamplePath?: string
}
