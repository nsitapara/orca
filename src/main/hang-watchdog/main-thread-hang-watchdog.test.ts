import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { HangWatchdogWorkerToMainMessage } from './hang-watchdog-worker-protocol'

const { breadcrumbs, worker, spawnWorkerThread } = vi.hoisted(() => {
  const worker = { postMessage: vi.fn(), unref: vi.fn(), on: vi.fn(), once: vi.fn() }
  return {
    breadcrumbs: new Array<[string, unknown]>(),
    worker,
    spawnWorkerThread: vi.fn(() => worker)
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: true, getAppPath: () => '/apps/orca/app.asar', on: vi.fn(), off: vi.fn() }
}))
vi.mock('../worker-threads/worker-thread-spawn', () => ({ spawnWorkerThread }))
vi.mock('../observability', () => ({
  resolveObservabilityConsent: () => ({ localFileEnabled: true })
}))
vi.mock('../observability/logs-directory', () => ({ getLogsDirectory: () => '/ud/logs' }))
vi.mock('../crash-reporting/durable-crash-breadcrumb', () => ({
  recordDurableCrashBreadcrumb: (name: string, data: unknown) => breadcrumbs.push([name, data])
}))

import { installMainThreadHangWatchdog } from './main-thread-hang-watchdog'

describe('installMainThreadHangWatchdog', () => {
  // Why: a stall that clears leaves its early sample in logs/; the trace has to say which file.
  it('records a sampled stall the worker reports, naming only written sample files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hang-watchdog-main-'))
    const original = process.platform
    Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
    const handle = installMainThreadHangWatchdog({ userDataPath: '/ud' })
    Object.defineProperty(process, 'platform', { configurable: true, value: original })
    try {
      expect(spawnWorkerThread).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          workerData: expect.objectContaining({ sampleDir: '/ud/logs', stallSampleMs: 15_000 })
        })
      )
      const onMessage: (message: HangWatchdogWorkerToMainMessage) => void =
        worker.on.mock.calls.find(([event]) => event === 'message')?.[1]
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
      handle?.stop()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
