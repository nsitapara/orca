import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { workerState, appMock, breadcrumbs } = vi.hoisted(() => ({
  breadcrumbs: new Array<[string, unknown]>(),
  workerState: {
    calls: [] as unknown[][],
    instance: null as object | null,
    error: null as Error | null
  },
  appMock: {
    isPackaged: true,
    getAppPath: vi.fn(() => '/apps/orca/app.asar'),
    on: vi.fn(),
    off: vi.fn()
  }
}))

vi.mock('node:worker_threads', () => ({
  Worker: class WorkerMock {
    constructor(...args: unknown[]) {
      workerState.calls.push(args)
      if (workerState.error) {
        throw workerState.error
      }
      return workerState.instance as WorkerMock
    }
  }
}))

vi.mock('electron', () => ({
  app: appMock
}))

vi.mock('../observability/logs-directory', () => ({ getLogsDirectory: () => '/ud/logs' }))

vi.mock('../crash-reporting/durable-crash-breadcrumb', () => ({
  recordDurableCrashBreadcrumb: (name: string, data: unknown) => breadcrumbs.push([name, data])
}))

import { installMainThreadHangWatchdog } from './main-thread-hang-watchdog'

function withPlatform<T>(platform: NodeJS.Platform, run: () => T): T {
  const original = process.platform
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
  try {
    return run()
  } finally {
    Object.defineProperty(process, 'platform', { configurable: true, value: original })
  }
}

function fakeWorker() {
  return {
    postMessage: vi.fn(),
    unref: vi.fn(),
    on: vi.fn(),
    once: vi.fn()
  }
}

describe('installMainThreadHangWatchdog', () => {
  beforeEach(() => {
    for (const name of [
      'CI',
      'GITHUB_ACTIONS',
      'GITLAB_CI',
      'CIRCLECI',
      'TRAVIS',
      'BUILDKITE',
      'JENKINS_URL',
      'TEAMCITY_VERSION',
      'ORCA_DIAGNOSTICS_DISABLED'
    ]) {
      vi.stubEnv(name, '')
    }
    vi.useFakeTimers()
    workerState.calls = []
    workerState.instance = null
    workerState.error = null
    appMock.on.mockReset()
    appMock.off.mockReset()
    appMock.isPackaged = true
    delete process.env.ORCA_HANG_WATCHDOG_FORCE
    delete process.env.ORCA_HANG_WATCHDOG_TIMEOUT_MS
    delete process.env.ORCA_HANG_WATCHDOG_CHECK_INTERVAL_MS
    delete process.env.ORCA_HANG_WATCHDOG_STALL_SAMPLE_MS
  })

  afterEach(() => {
    for (const [event, listener] of appMock.on.mock.calls) {
      if (event === 'will-quit') {
        listener()
      }
    }
    vi.unstubAllEnvs()
    vi.useRealTimers()
    delete process.env.ORCA_HANG_WATCHDOG_FORCE
    delete process.env.ORCA_HANG_WATCHDOG_TIMEOUT_MS
    delete process.env.ORCA_HANG_WATCHDOG_CHECK_INTERVAL_MS
    delete process.env.ORCA_HANG_WATCHDOG_STALL_SAMPLE_MS
  })

  it.each(['win32', 'linux'] as const)('creates no worker or timers on %s', (platform) => {
    for (const isPackaged of [false, true]) {
      for (const forced of [false, true]) {
        appMock.isPackaged = isPackaged
        if (forced) {
          process.env.ORCA_HANG_WATCHDOG_FORCE = '1'
        } else {
          delete process.env.ORCA_HANG_WATCHDOG_FORCE
        }
        expect(
          withPlatform(platform, () => installMainThreadHangWatchdog({ userDataPath: '/ud' }))
        ).toBeNull()
        expect(workerState.calls).toHaveLength(0)
        expect(vi.getTimerCount()).toBe(0)
        expect(appMock.on).not.toHaveBeenCalled()
      }
    }
  })

  it.each(['darwin'] as const)('respects development and diagnostics gates on %s', (platform) => {
    appMock.isPackaged = false
    expect(
      withPlatform(platform, () => installMainThreadHangWatchdog({ userDataPath: '/ud' }))
    ).toBeNull()
    process.env.ORCA_HANG_WATCHDOG_FORCE = '1'
    vi.stubEnv('ORCA_DIAGNOSTICS_DISABLED', '1')
    expect(
      withPlatform(platform, () => installMainThreadHangWatchdog({ userDataPath: '/ud' }))
    ).toBeNull()
    vi.unstubAllEnvs()
    expect(workerState.calls).toHaveLength(0)
  })

  it('is a no-op in unpackaged builds unless forced', () => {
    appMock.isPackaged = false
    expect(
      withPlatform('darwin', () => installMainThreadHangWatchdog({ userDataPath: '/ud' }))
    ).toBeNull()
    process.env.ORCA_HANG_WATCHDOG_FORCE = '1'
    const worker = fakeWorker()
    workerState.instance = worker
    expect(
      withPlatform('darwin', () => installMainThreadHangWatchdog({ userDataPath: '/ud' }))
    ).not.toBeNull()
    delete process.env.ORCA_HANG_WATCHDOG_FORCE
  })

  it('starts a worker with pid, marker, and timing config', () => {
    const worker = fakeWorker()
    workerState.instance = worker
    const handle = withPlatform('darwin', () =>
      installMainThreadHangWatchdog({ userDataPath: '/ud' })
    )
    expect(handle).not.toBeNull()
    const [workerPath, rawOptions] = workerState.calls[0]
    const options = rawOptions as {
      name: string
      workerData: {
        parentPid: number
        markerPath: string
        timeoutMs: number
        checkIntervalMs: number
      }
    }
    expect(workerPath).toBe(
      join('/apps/orca/app.asar', 'out', 'main', 'main-thread-hang-watchdog-entry.js')
    )
    expect(options.name).toBe('orca-main-thread-hang-watchdog')
    expect(options.workerData).toMatchObject({
      parentPid: process.pid,
      markerPath: join('/ud', 'main-thread-hang.json'),
      timeoutMs: 45_000,
      checkIntervalMs: 5_000,
      sampleDir: '/ud/logs',
      stallSampleMs: 15_000
    })
    expect(worker.unref).toHaveBeenCalled()
  })

  it('sends heartbeats on an interval and shutdown on stop', () => {
    const worker = fakeWorker()
    workerState.instance = worker
    const handle = withPlatform('darwin', () =>
      installMainThreadHangWatchdog({ userDataPath: '/ud' })
    )
    vi.advanceTimersByTime(6_000)
    const heartbeats = worker.postMessage.mock.calls.filter(([m]) => m.type === 'heartbeat')
    expect(heartbeats.length).toBe(3)

    handle?.stop()
    expect(worker.postMessage.mock.calls.some(([m]) => m.type === 'shutdown')).toBe(true)
    expect(appMock.off).toHaveBeenCalledWith('will-quit', expect.any(Function))

    handle?.stop()
    const shutdowns = worker.postMessage.mock.calls.filter(([m]) => m.type === 'shutdown')
    expect(shutdowns.length).toBe(1)

    vi.advanceTimersByTime(10_000)
    const heartbeatsAfterStop = worker.postMessage.mock.calls.filter(
      ([m]) => m.type === 'heartbeat'
    )
    expect(heartbeatsAfterStop.length).toBe(3)
  })

  it('passes test timing overrides to the worker', () => {
    process.env.ORCA_HANG_WATCHDOG_TIMEOUT_MS = '900'
    process.env.ORCA_HANG_WATCHDOG_CHECK_INTERVAL_MS = '100'
    process.env.ORCA_HANG_WATCHDOG_STALL_SAMPLE_MS = '300'
    workerState.instance = fakeWorker()
    withPlatform('darwin', () => installMainThreadHangWatchdog({ userDataPath: '/ud' }))
    const options = workerState.calls[0][1] as {
      workerData: { timeoutMs: number; checkIntervalMs: number }
    }
    expect(options.workerData).toMatchObject({
      timeoutMs: 900,
      checkIntervalMs: 100,
      stallSampleMs: 300
    })
  })

  // Why: a stall that clears leaves its early sample in logs/; the trace has to say which file.
  it('records a sampled stall the worker reports, naming only written sample files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hang-watchdog-main-'))
    try {
      const worker = fakeWorker()
      workerState.instance = worker
      breadcrumbs.length = 0
      withPlatform('darwin', () => installMainThreadHangWatchdog({ userDataPath: '/ud' }))
      const onMessage = worker.on.mock.calls.find(([event]) => event === 'message')?.[1]
      const written = join(dir, 'main-thread-sample-1970-01-01T00-00-20-000Z-stall.txt')
      writeFileSync(written, '')
      onMessage({
        type: 'stall-sampled',
        unresponsiveMs: 21_000,
        hang: false,
        stallSamplePath: written,
        samplePath: join(dir, 'never-written.txt')
      })
      expect(breadcrumbs).toEqual([
        [
          'main_thread_stall_sampled',
          {
            unresponsiveMs: 21_000,
            hang: false,
            stallSampleFile: 'main-thread-sample-1970-01-01T00-00-20-000Z-stall.txt'
          }
        ]
      ])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('registers stop on will-quit', () => {
    workerState.instance = fakeWorker()
    withPlatform('darwin', () => installMainThreadHangWatchdog({ userDataPath: '/ud' }))
    expect(appMock.on).toHaveBeenCalledWith('will-quit', expect.any(Function))
  })

  it('stops heartbeat work when the worker exits', () => {
    const worker = fakeWorker()
    workerState.instance = worker
    withPlatform('darwin', () => installMainThreadHangWatchdog({ userDataPath: '/ud' }))
    const exitListener = worker.once.mock.calls.find(([event]) => event === 'exit')?.[1]
    expect(exitListener).toEqual(expect.any(Function))
    exitListener()
    expect(appMock.off).toHaveBeenCalledWith('will-quit', expect.any(Function))
    vi.advanceTimersByTime(6_000)
    expect(worker.postMessage).not.toHaveBeenCalled()
  })

  it('returns null and stays inert when worker construction fails', () => {
    workerState.error = new Error('worker failure')
    expect(
      withPlatform('darwin', () => installMainThreadHangWatchdog({ userDataPath: '/ud' }))
    ).toBeNull()
  })
})
