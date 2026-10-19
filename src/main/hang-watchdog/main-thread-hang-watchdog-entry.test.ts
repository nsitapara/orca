import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { consumeHangDetectionMarker } from './hang-detection-marker'
import type { RunSampleProgram } from './main-thread-stack-sampler'
import type {
  HangWatchdogWorkerToMainMessage,
  MainToHangWatchdogWorkerMessage
} from './hang-watchdog-worker-protocol'

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(() => ({ unref: vi.fn() }))
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

import {
  isHangWatchdogWorkerData,
  recordHangObservation,
  runWatchdog
} from './main-thread-hang-watchdog-entry'

describe('recordHangObservation', () => {
  let dir: string
  let killSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'hang-detect-'))
    spawnMock.mockClear()
    killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    killSpy.mockRestore()
    exitSpy.mockRestore()
    rmSync(dir, { recursive: true, force: true })
  })

  it('records an unresolved hang', () => {
    const markerPath = join(dir, 'marker.json')
    recordHangObservation({
      parentPid: 4242,
      markerPath,
      detectedAt: 1_000,
      unresponsiveMs: 47_000,
      selfRecovered: false
    })
    expect(consumeHangDetectionMarker(markerPath)).toMatchObject({
      detectedAt: 1_000,
      parentPid: 4242,
      unresponsiveMs: 47_000,
      selfRecovered: false
    })
  })

  it('overwrites the marker when the stall clears, keeping one observation per stall', () => {
    const markerPath = join(dir, 'marker.json')
    recordHangObservation({
      parentPid: 4242,
      markerPath,
      detectedAt: 1_000,
      unresponsiveMs: 47_000,
      selfRecovered: false
    })
    recordHangObservation({
      parentPid: 4242,
      markerPath,
      detectedAt: 1_000,
      unresponsiveMs: 62_000,
      selfRecovered: true
    })
    expect(consumeHangDetectionMarker(markerPath)).toMatchObject({
      detectedAt: 1_000,
      unresponsiveMs: 62_000,
      selfRecovered: true
    })
  })

  it('never spawns, signals, or exits', () => {
    // Why: a false positive must never kill a live main thread while writes may be in flight.
    recordHangObservation({
      parentPid: 4242,
      markerPath: join(dir, 'marker.json'),
      detectedAt: 1_000,
      unresponsiveMs: 45_000,
      selfRecovered: false
    })
    expect(spawnMock).not.toHaveBeenCalled()
    expect(killSpy).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
  })

  it('survives an unwritable marker path and reports the write failed', () => {
    expect(
      recordHangObservation({
        parentPid: 4242,
        markerPath: join(dir, 'missing-subdir', 'marker.json'),
        detectedAt: 1_000,
        unresponsiveMs: 45_000,
        selfRecovered: false
      })
    ).toBe(false)
  })

  it('is a no-op when no marker path is configured', () => {
    expect(() =>
      recordHangObservation({
        parentPid: 4242,
        markerPath: '',
        detectedAt: 1_000,
        unresponsiveMs: 45_000,
        selfRecovered: false
      })
    ).not.toThrow()
  })
})

describe('watchdog worker entry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts only complete positive worker data', () => {
    expect(
      isHangWatchdogWorkerData({
        parentPid: 42,
        markerPath: '/tmp/marker',
        timeoutMs: 100,
        checkIntervalMs: 25
      })
    ).toBe(true)
    for (const value of [
      null,
      {},
      { parentPid: 0, markerPath: '/tmp/marker', timeoutMs: 100, checkIntervalMs: 25 },
      { parentPid: 42, markerPath: 7, timeoutMs: 100, checkIntervalMs: 25 },
      { parentPid: 42, markerPath: '/tmp/marker', timeoutMs: 0, checkIntervalMs: 25 },
      { parentPid: 42, markerPath: '/tmp/marker', timeoutMs: 100, checkIntervalMs: Infinity },
      {
        parentPid: 42,
        markerPath: '/tmp/marker',
        timeoutMs: 100,
        checkIntervalMs: 25,
        sampleDir: 7
      },
      {
        parentPid: 42,
        markerPath: '/tmp/marker',
        timeoutMs: 100,
        checkIntervalMs: 25,
        stallSampleMs: 0
      }
    ]) {
      expect(isHangWatchdogWorkerData(value)).toBe(false)
    }
  })

  it('routes heartbeats and shuts down its timer and port', () => {
    const markerPath = join(tmpdir(), `hang-watchdog-entry-${process.pid}.json`)
    let onMessage: ((message: { type: 'heartbeat' | 'shutdown' }) => void) | undefined
    const port = {
      on: vi.fn(
        (_event: 'message', listener: (message: { type: 'heartbeat' | 'shutdown' }) => void) => {
          onMessage = listener
        }
      ),
      postMessage: vi.fn(),
      close: vi.fn()
    }
    try {
      runWatchdog(
        {
          parentPid: process.pid,
          markerPath,
          timeoutMs: 100,
          checkIntervalMs: 25
        },
        port
      )
      vi.advanceTimersByTime(75)
      onMessage?.({ type: 'heartbeat' })
      vi.advanceTimersByTime(75)
      expect(consumeHangDetectionMarker(markerPath)).toBeNull()
      vi.advanceTimersByTime(50)
      expect(consumeHangDetectionMarker(markerPath)).toMatchObject({ selfRecovered: false })

      onMessage?.({ type: 'heartbeat' })
      expect(consumeHangDetectionMarker(markerPath)).toMatchObject({ selfRecovered: true })
      onMessage?.({ type: 'shutdown' })
      expect(port.close).toHaveBeenCalledOnce()
      vi.advanceTimersByTime(1_000)
      expect(port.close).toHaveBeenCalledOnce()
      expect(consumeHangDetectionMarker(markerPath)).toBeNull()
    } finally {
      rmSync(markerPath, { force: true })
    }
  })

  // Why: the hang that ended in SIGKILL after two hours was reported as "silent ≥45 s"; the marker
  // has to keep growing while the hang lasts, and a write that failed has to be tried again.
  it('refreshes an ongoing hang marker, keeps its detection time, and retries a failed write', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hang-watchdog-refresh-'))
    const markerPath = join(dir, 'marker.json')
    const port = { on: vi.fn(), postMessage: vi.fn(), close: vi.fn() }
    try {
      runWatchdog(
        { parentPid: process.pid, markerPath, timeoutMs: 45_000, checkIntervalMs: 5_000 },
        port
      )
      vi.advanceTimersByTime(50_000)
      expect(consumeHangDetectionMarker(markerPath)).toEqual({
        detectedAt: 50_000,
        parentPid: process.pid,
        unresponsiveMs: 50_000,
        selfRecovered: false
      })
      // A rewrite within 30 s of the last one is skipped; the next due one lands.
      vi.advanceTimersByTime(25_000)
      expect(consumeHangDetectionMarker(markerPath)).toBeNull()
      vi.advanceTimersByTime(5_000)
      expect(consumeHangDetectionMarker(markerPath)).toMatchObject({
        detectedAt: 50_000,
        unresponsiveMs: 80_000
      })
      rmSync(dir, { recursive: true, force: true })
      vi.advanceTimersByTime(30_000)
      mkdirSync(dir)
      vi.advanceTimersByTime(5_000)
      expect(consumeHangDetectionMarker(markerPath)).toMatchObject({
        detectedAt: 50_000,
        unresponsiveMs: 115_000
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  describe('stack samples', () => {
    let dir: string
    let markerPath: string
    let onMessage: ((message: MainToHangWatchdogWorkerMessage) => void) | undefined
    let postMessage: ReturnType<typeof vi.fn<(message: HangWatchdogWorkerToMainMessage) => void>>
    let runSample: ReturnType<typeof vi.fn<RunSampleProgram>>

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'hang-watchdog-samples-'))
      markerPath = join(dir, 'marker.json')
      postMessage = vi.fn<(message: HangWatchdogWorkerToMainMessage) => void>()
      const port = {
        on: (_event: 'message', listener: (message: MainToHangWatchdogWorkerMessage) => void) => {
          onMessage = listener
        },
        postMessage,
        close: vi.fn()
      }
      runSample = vi.fn<RunSampleProgram>(async () => ({ code: 0 }))
      runWatchdog(
        {
          parentPid: 4242,
          markerPath,
          timeoutMs: 45_000,
          checkIntervalMs: 5_000,
          sampleDir: join(dir, 'logs'),
          stallSampleMs: 15_000
        },
        port,
        runSample
      )
    })

    afterEach(() => {
      onMessage?.({ type: 'shutdown' })
      rmSync(dir, { recursive: true, force: true })
    })

    const sampledFiles = (): string[] =>
      runSample.mock.calls.map(([, args]) => args[3].slice(join(dir, 'logs').length + 1))

    it('samples a stall early, samples again at the hang, and names both in the marker', async () => {
      await vi.advanceTimersByTimeAsync(20_000)
      expect(sampledFiles()).toEqual(['main-thread-sample-1970-01-01T00-00-20-000Z-stall.txt'])
      await vi.advanceTimersByTimeAsync(30_000)
      expect(sampledFiles()).toEqual([
        'main-thread-sample-1970-01-01T00-00-20-000Z-stall.txt',
        'main-thread-sample-1970-01-01T00-00-50-000Z-hang.txt'
      ])
      expect(consumeHangDetectionMarker(markerPath)).toMatchObject({
        selfRecovered: false,
        stallSamplePath: join(dir, 'logs', 'main-thread-sample-1970-01-01T00-00-20-000Z-stall.txt'),
        samplePath: join(dir, 'logs', 'main-thread-sample-1970-01-01T00-00-50-000Z-hang.txt')
      })
    })

    it('tells main about a sampled stall once heartbeats resume and the sample is written', async () => {
      await vi.advanceTimersByTimeAsync(20_000)
      onMessage?.({ type: 'heartbeat' })
      await vi.waitFor(() => expect(postMessage).toHaveBeenCalledOnce())
      expect(postMessage).toHaveBeenCalledWith({
        type: 'stall-sampled',
        unresponsiveMs: 20_000,
        hang: false,
        stallSamplePath: join(dir, 'logs', 'main-thread-sample-1970-01-01T00-00-20-000Z-stall.txt')
      })
      expect(consumeHangDetectionMarker(markerPath)).toBeNull()
    })

    it('does not name a sample that sample failed to write', async () => {
      runSample.mockResolvedValue({ code: 1 })
      await vi.advanceTimersByTimeAsync(50_000)
      onMessage?.({ type: 'heartbeat' })
      await vi.advanceTimersByTimeAsync(0)
      expect(runSample).toHaveBeenCalledTimes(2)
      expect(postMessage).not.toHaveBeenCalled()
    })
  })
})
