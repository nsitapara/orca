import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { createHangWatchdogDetectionLoop } from './hang-watchdog-detection-loop'
import { writeHangDetectionMarker } from './hang-detection-marker'
import type {
  HangWatchdogWorkerData,
  MainToHangWatchdogWorkerMessage
} from './hang-watchdog-worker-protocol'

type HangWatchdogPort = {
  on: (event: 'message', listener: (message: MainToHangWatchdogWorkerMessage) => void) => unknown
  close: () => void
}

// How often an ongoing hang's marker is rewritten with its growing duration.
const HANG_MARKER_REFRESH_MS = 30_000

// Observation only: a false positive must never kill a live main thread mid-write.
// Returns whether the marker landed, so a failed write is retried on the next check.
export function recordHangObservation(options: {
  parentPid: number
  markerPath: string
  detectedAt: number
  unresponsiveMs: number
  selfRecovered: boolean
}): boolean {
  if (!options.markerPath) {
    return false
  }
  try {
    writeHangDetectionMarker(options.markerPath, {
      detectedAt: options.detectedAt,
      parentPid: options.parentPid,
      unresponsiveMs: options.unresponsiveMs,
      selfRecovered: options.selfRecovered
    })
    return true
  } catch {
    // Why: telemetry is best-effort; a marker that cannot be written must not take down the watchdog.
    return false
  }
}

export function runWatchdog(
  config: HangWatchdogWorkerData,
  port: HangWatchdogPort | null = parentPort
): void {
  if (!port) {
    return
  }
  let hangDetectedAt = 0
  // Silence the marker last recorded; null after a failed write so the next check retries it.
  let recordedUnresponsiveMs: number | null = null
  const record = (unresponsiveMs: number, selfRecovered: boolean): void => {
    const written = recordHangObservation({
      parentPid: config.parentPid,
      markerPath: config.markerPath,
      detectedAt: hangDetectedAt,
      unresponsiveMs,
      selfRecovered
    })
    recordedUnresponsiveMs = written ? unresponsiveMs : null
  }
  const loop = createHangWatchdogDetectionLoop({
    timeoutMs: config.timeoutMs,
    checkIntervalMs: config.checkIntervalMs,
    now: () => Date.now(),
    onHangDetected: (unresponsiveMs) => {
      hangDetectedAt = Date.now()
      record(unresponsiveMs, false)
    },
    // Why: a hang that ends in SIGKILL never resolves, so only these rewrites say how long it ran.
    onHangContinued: (unresponsiveMs) => {
      if (
        recordedUnresponsiveMs === null ||
        unresponsiveMs - recordedUnresponsiveMs >= HANG_MARKER_REFRESH_MS
      ) {
        record(unresponsiveMs, false)
      }
    },
    // Why: rewriting the marker keeps one observation per stall rather than two rows to reconcile.
    onHangResolved: (unresponsiveMs) => record(unresponsiveMs, true)
  })

  let checkTimer: ReturnType<typeof setInterval> | null = setInterval(
    () => loop.tick(),
    config.checkIntervalMs
  )
  port.on('message', (message: MainToHangWatchdogWorkerMessage) => {
    if (message.type === 'heartbeat') {
      loop.recordHeartbeat()
    } else if (message.type === 'shutdown') {
      if (checkTimer) {
        clearInterval(checkTimer)
        checkTimer = null
      }
      port.close()
    }
  })
}

export function isHangWatchdogWorkerData(value: unknown): value is HangWatchdogWorkerData {
  const data = value as Partial<HangWatchdogWorkerData> | null
  return (
    !!data &&
    Number.isInteger(data.parentPid) &&
    (data.parentPid ?? 0) > 0 &&
    typeof data.markerPath === 'string' &&
    Number.isFinite(data.timeoutMs) &&
    (data.timeoutMs ?? 0) > 0 &&
    Number.isFinite(data.checkIntervalMs) &&
    (data.checkIntervalMs ?? 0) > 0
  )
}

if (!isMainThread && isHangWatchdogWorkerData(workerData)) {
  runWatchdog(workerData)
}
