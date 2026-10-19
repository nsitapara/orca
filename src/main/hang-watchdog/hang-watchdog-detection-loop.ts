export type HangWatchdogDetectionLoopConfig = {
  timeoutMs: number
  checkIntervalMs: number
  /** Silence that counts as a stall worth noting before it is long enough to be a hang. */
  stallMs?: number
  now: () => number
  /** Once per stall, when the silence first passes `stallMs`. */
  onStallDetected?: (unresponsiveMs: number) => void
  onHangDetected: (unresponsiveMs: number) => void
  /** Each later check while the hang lasts, so a killed app still reports how long it ran. */
  onHangContinued?: (unresponsiveMs: number) => void
  /** Heartbeats resumed after a detected hang — the main thread was stalled, not deadlocked. */
  onHangResolved: (unresponsiveMs: number) => void
  /** Heartbeats resumed after a stall that never reached the hang timeout. */
  onStallResolved?: (unresponsiveMs: number) => void
}

export type HangWatchdogDetectionLoop = {
  recordHeartbeat: () => void
  tick: () => void
}

export function createHangWatchdogDetectionLoop(
  config: HangWatchdogDetectionLoopConfig
): HangWatchdogDetectionLoop {
  let lastHeartbeatAt = config.now()
  let lastTickAt = config.now()
  let phase: 'responsive' | 'stalled' | 'hung' = 'responsive'
  return {
    recordHeartbeat: () => {
      const now = config.now()
      if (phase === 'hung') {
        config.onHangResolved(now - lastHeartbeatAt)
      } else if (phase === 'stalled') {
        config.onStallResolved?.(now - lastHeartbeatAt)
      }
      phase = 'responsive'
      lastHeartbeatAt = now
    },
    tick: () => {
      const now = config.now()
      const tickGap = now - lastTickAt
      // Why: advance the tick clock even while a hang is outstanding, or the first tick after the
      // stall clears reads as a huge gap and gets misread as system sleep.
      lastTickAt = now
      if (phase === 'hung') {
        config.onHangContinued?.(now - lastHeartbeatAt)
        return
      }
      // Why: system sleep suspends this process too; a huge tick gap means suspension, not a parent hang, so restart the wait from scratch.
      if (tickGap > config.checkIntervalMs * 3) {
        lastHeartbeatAt = now
        return
      }
      const unresponsiveMs = now - lastHeartbeatAt
      if (unresponsiveMs > config.timeoutMs) {
        phase = 'hung'
        config.onHangDetected(unresponsiveMs)
      } else if (
        phase === 'responsive' &&
        config.stallMs !== undefined &&
        unresponsiveMs > config.stallMs
      ) {
        phase = 'stalled'
        config.onStallDetected?.(unresponsiveMs)
      }
    }
  }
}
