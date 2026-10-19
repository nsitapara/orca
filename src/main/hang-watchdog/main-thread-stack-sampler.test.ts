import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_STACK_SAMPLES_KEPT,
  STALL_SAMPLE_MIN_INTERVAL_MS,
  createMainThreadStackSampler,
  type RunSampleProgram
} from './main-thread-stack-sampler'

type SampleRun = { resolve: (code: number) => void; reject: (error: Error) => void }

describe('main thread stack sampler', () => {
  let dir: string
  let logs: string
  let now: number
  let runs: SampleRun[]
  let run: ReturnType<typeof vi.fn<RunSampleProgram>>

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'stack-sampler-'))
    logs = join(dir, 'logs')
    now = Date.parse('2026-10-16T23:38:35.000Z')
    runs = []
    run = vi.fn<RunSampleProgram>(
      () =>
        new Promise((resolve, reject) =>
          runs.push({ resolve: (code) => resolve({ code }), reject })
        )
    )
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function sampler(sampleDir = logs) {
    return createMainThreadStackSampler({ parentPid: 4242, sampleDir, now: () => now, run })
  }

  it('runs /usr/bin/sample on the parent for 3 s into a time-named file in the logs folder', async () => {
    const sample = sampler().capture('hang')
    const expectedPath = join(logs, 'main-thread-sample-2026-10-16T23-38-35-000Z-hang.txt')
    expect(sample?.path).toBe(expectedPath)
    expect(run).toHaveBeenCalledWith('/usr/bin/sample', ['4242', '3', '-file', expectedPath])
    runs[0].resolve(0)
    await expect(sample?.done).resolves.toBe(true)
  })

  it.each([
    ['exits non-zero', (sampleRun: SampleRun) => sampleRun.resolve(1)],
    ['cannot start', (sampleRun: SampleRun) => sampleRun.reject(new Error('ENOENT'))]
  ])('reports no file when sample %s', async (_case, settle) => {
    const sample = sampler().capture('hang')
    settle(runs[0])
    await expect(sample?.done).resolves.toBe(false)
  })

  it('takes one sample at a time', async () => {
    const instance = sampler()
    const first = instance.capture('hang')
    expect(instance.capture('hang')).toBeNull()
    runs[0].resolve(0)
    await first?.done
    await Promise.resolve()
    expect(instance.capture('hang')).not.toBeNull()
  })

  it('takes at most one stall sample per window but still samples a hang', async () => {
    const instance = sampler()
    const stall = instance.capture('stall')
    runs[0].resolve(0)
    await stall?.done
    await Promise.resolve()
    now += STALL_SAMPLE_MIN_INTERVAL_MS - 1
    expect(instance.capture('stall')).toBeNull()
    const hang = instance.capture('hang')
    expect(hang).not.toBeNull()
    runs[1].resolve(0)
    await hang?.done
    await Promise.resolve()
    now += 1
    expect(instance.capture('stall')).not.toBeNull()
  })

  it('keeps only the newest samples and leaves other log files alone', () => {
    mkdirSync(logs)
    const old = Array.from(
      { length: MAX_STACK_SAMPLES_KEPT + 2 },
      (_, index) => `main-thread-sample-2026-01-${String(index + 10)}T00-00-00-000Z-hang.txt`
    )
    for (const name of old) {
      writeFileSync(join(logs, name), '')
    }
    writeFileSync(join(logs, 'main.trace.ndjson'), '')
    const sample = sampler().capture('hang')
    const kept = readdirSync(logs).filter((name) => name.startsWith('main-thread-sample-'))
    // The new sample becomes the tenth file once `sample` writes it.
    expect(kept.sort()).toEqual(old.slice(-(MAX_STACK_SAMPLES_KEPT - 1)))
    expect(sample?.path.endsWith('main-thread-sample-2026-10-16T23-38-35-000Z-hang.txt')).toBe(true)
    expect(existsSync(join(logs, 'main.trace.ndjson'))).toBe(true)
  })

  it('skips sampling when the logs folder cannot be created', () => {
    const blocker = join(dir, 'not-a-directory')
    writeFileSync(blocker, '')
    expect(sampler(join(blocker, 'logs')).capture('hang')).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })
})
