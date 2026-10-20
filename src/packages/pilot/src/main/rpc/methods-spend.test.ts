import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { PilotContext } from '../pilot-services'
import { PilotStore } from '../store/store'
import { buildSpendMethods } from './methods-spend'

type Callable = {
  name: string
  params: { safeParse(v: unknown): { success: boolean } }
  handler(p: unknown, rpc?: { caller?: { kind: string } }): unknown
}

function method(name = 'pilot.spend'): Callable {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-spend-rpc-')), 'db.sqlite'))
  const ctx = {
    store,
    loaded: () => ({ definitions: [{ id: 'fix-ci', name: 'Fix failed CI' }] })
  } as unknown as PilotContext
  return (buildSpendMethods(() => ctx) as unknown as Callable[]).find((m) => m.name === name)!
}

describe('pilot.spend', () => {
  it('defaults to the last 7 days by automation', () => {
    expect(method().handler({})).toMatchObject({
      by: 'automation',
      days: 7,
      rows: [],
      total: { costUsd: 0, tokens: 0, runs: 0 }
    })
  })

  it.each([
    [{ by: 'skill', days: 30 }, true],
    [{ by: 'repo' }, false],
    [{ days: 0 }, false],
    [{ days: 1.5 }, false]
  ])('params %o valid: %s', (params, ok) => {
    expect(method().params.safeParse(params).success).toBe(ok)
  })
})

describe('pilot.usage.dashboard', () => {
  it('answers an empty period with zeros', () => {
    expect(method('pilot.usage.dashboard').handler({ days: 1 })).toMatchObject({
      days: 1,
      total: { runs: 0, tokens: 0, costUsd: null },
      automations: [],
      topRuns: [],
      sinceReset: {}
    })
  })

  it.each([
    [{ days: 7 }, true],
    [{ days: 30, resetDays: { codex: '2026-10-20' } }, true],
    [{ days: 91 }, false],
    [{}, false],
    [{ days: 7, resetDays: { codex: 'Tuesday' } }, false]
  ])('params %o valid: %s', (params, ok) => {
    expect(method('pilot.usage.dashboard').params.safeParse(params).success).toBe(ok)
  })
})

describe('pilot.usage.writeReport', () => {
  function writeMethod(writeUsageReport?: (dir?: string) => unknown): Callable {
    const ctx = { writeUsageReport } as unknown as PilotContext
    return (buildSpendMethods(() => ctx) as unknown as Callable[]).find(
      (m) => m.name === 'pilot.usage.writeReport'
    )!
  }

  const LOCAL = { caller: { kind: 'local-cli' as const } }

  it('passes the folder through to the reporter', () => {
    const write = vi.fn(() => ({ dir: '/x', rows: 0, sessions: 0, costUsd: 0, files: [] }))
    expect(writeMethod(write).handler({ dir: '/x' }, LOCAL)).toMatchObject({ dir: '/x' })
    expect(write).toHaveBeenCalledWith('/x')
  })

  it('needs an absolute folder, and a process that runs the reporter', () => {
    expect(writeMethod().params.safeParse({ dir: 'relative/path' }).success).toBe(false)
    expect(() => writeMethod().handler({}, LOCAL)).toThrow(
      "The usage report isn't available in this process"
    )
  })

  it('writes nothing for a caller the transport did not identify', () => {
    const write = vi.fn()
    expect(() => writeMethod(write).handler({ dir: '/x' }, {})).toThrow(
      "Pilot can't tell who is calling; nothing was written"
    )
    expect(write).not.toHaveBeenCalled()
  })
})
