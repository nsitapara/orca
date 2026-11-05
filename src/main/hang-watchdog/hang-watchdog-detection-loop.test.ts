import { describe, expect, it, vi } from 'vitest'
import { createHangWatchdogDetectionLoop } from './hang-watchdog-detection-loop'

const TIMEOUT_MS = 45_000
const CHECK_INTERVAL_MS = 5_000

function loopWithClock(startAt = 0, stallMs?: number) {
  let now = startAt
  const onStallDetected = vi.fn()
  const onStallResolved = vi.fn()
  const onHangDetected = vi.fn()
  const onHangContinued = vi.fn()
  const onHangResolved = vi.fn()
  const loop = createHangWatchdogDetectionLoop({
    timeoutMs: TIMEOUT_MS,
    checkIntervalMs: CHECK_INTERVAL_MS,
    stallMs,
    now: () => now,
    onStallDetected,
    onStallResolved,
    onHangDetected,
    onHangContinued,
    onHangResolved
  })
  return {
    loop,
    onStallDetected,
    onStallResolved,
    onHangDetected,
    onHangContinued,
    onHangResolved,
    advance: (ms: number) => (now += ms)
  }
}

function silentChecks(loop: { tick: () => void }, advance: (ms: number) => void, count: number) {
  for (let i = 0; i < count; i++) {
    advance(CHECK_INTERVAL_MS)
    loop.tick()
  }
}

describe('createHangWatchdogDetectionLoop', () => {
  it('treats a large tick gap as system sleep and restarts the wait', () => {
    const { loop, onHangDetected, advance } = loopWithClock()
    loop.recordHeartbeat()
    // Model system suspension: the watchdog itself missed multiple timer ticks.
    advance(TIMEOUT_MS * 4)
    loop.tick()
    expect(onHangDetected).not.toHaveBeenCalled()
    // After wake, require a fresh timeout of silence rather than counting suspended time.
    for (let i = 0; i < 9; i++) {
      advance(CHECK_INTERVAL_MS)
      loop.tick()
    }
    expect(onHangDetected).not.toHaveBeenCalled()
    for (let i = 0; i < 3; i++) {
      advance(CHECK_INTERVAL_MS)
      loop.tick()
    }
    expect(onHangDetected).toHaveBeenCalledTimes(1)
  })

  it('reports the growing silence on each check while a detected hang lasts', () => {
    const { loop, onHangDetected, onHangContinued, advance } = loopWithClock()
    loop.recordHeartbeat()
    for (let i = 0; i < 14; i++) {
      advance(CHECK_INTERVAL_MS)
      loop.tick()
    }
    expect(onHangDetected).toHaveBeenCalledTimes(1)
    expect(onHangContinued.mock.calls).toEqual([[55_000], [60_000], [65_000], [70_000]])
    advance(CHECK_INTERVAL_MS)
    loop.recordHeartbeat()
    advance(CHECK_INTERVAL_MS)
    loop.tick()
    expect(onHangContinued).toHaveBeenCalledTimes(4)
  })

  it('notes a stall once when silence passes the stall threshold, then the hang', () => {
    const { loop, onStallDetected, onStallResolved, onHangDetected, advance } = loopWithClock(
      0,
      15_000
    )
    silentChecks(loop, advance, 3)
    expect(onStallDetected).not.toHaveBeenCalled()
    silentChecks(loop, advance, 6)
    expect(onStallDetected.mock.calls).toEqual([[20_000]])
    silentChecks(loop, advance, 1)
    expect(onHangDetected).toHaveBeenCalledWith(50_000)
    expect(onStallDetected).toHaveBeenCalledOnce()
    expect(onStallResolved).not.toHaveBeenCalled()
  })

  it('reports a stall that clears before the hang timeout as a resolved stall, not a hang', () => {
    const { loop, onStallDetected, onStallResolved, onHangResolved, advance } = loopWithClock(
      0,
      15_000
    )
    silentChecks(loop, advance, 5)
    advance(1_000)
    loop.recordHeartbeat()
    expect(onStallDetected).toHaveBeenCalledOnce()
    expect(onStallResolved).toHaveBeenCalledWith(26_000)
    expect(onHangResolved).not.toHaveBeenCalled()
    silentChecks(loop, advance, 5)
    expect(onStallDetected).toHaveBeenCalledTimes(2)
  })

  it('notes no stalls without a stall threshold', () => {
    const { loop, onStallDetected, onStallResolved, advance } = loopWithClock()
    silentChecks(loop, advance, 8)
    loop.recordHeartbeat()
    expect(onStallDetected).not.toHaveBeenCalled()
    expect(onStallResolved).not.toHaveBeenCalled()
  })

  it('can detect a second hang after the first one resolved', () => {
    const { loop, onHangDetected, onHangResolved, advance } = loopWithClock()
    loop.recordHeartbeat()
    for (let i = 0; i < 12; i++) {
      advance(CHECK_INTERVAL_MS)
      loop.tick()
    }
    advance(CHECK_INTERVAL_MS)
    loop.recordHeartbeat()
    expect(onHangResolved).toHaveBeenCalledTimes(1)
    // Keep the tick clock advancing during a hang so recovery cannot look like system suspension.
    for (let i = 0; i < 12; i++) {
      advance(CHECK_INTERVAL_MS)
      loop.tick()
    }
    expect(onHangDetected).toHaveBeenCalledTimes(2)
  })
})
