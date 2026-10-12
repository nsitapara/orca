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
  handler(p: unknown): unknown
}

function method(): Callable {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-spend-rpc-')), 'db.sqlite'))
  const ctx = {
    store,
    loaded: () => ({ definitions: [{ id: 'fix-ci', name: 'Fix failed CI' }] })
  } as unknown as PilotContext
  return (buildSpendMethods(() => ctx) as unknown as Callable[]).find(
    (m) => m.name === 'pilot.spend'
  )!
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

describe('pilot.usage.writeReport', () => {
  function writeMethod(writeUsageReport?: (dir?: string) => unknown): Callable {
    const ctx = { writeUsageReport } as unknown as PilotContext
    return (buildSpendMethods(() => ctx) as unknown as Callable[]).find(
      (m) => m.name === 'pilot.usage.writeReport'
    )!
  }

  it('passes the folder through to the reporter', () => {
    const write = vi.fn(() => ({ dir: '/x', rows: 0, sessions: 0, costUsd: 0, files: [] }))
    expect(writeMethod(write).handler({ dir: '/x' })).toMatchObject({ dir: '/x' })
    expect(write).toHaveBeenCalledWith('/x')
  })

  it('needs an absolute folder, and a process that runs the reporter', () => {
    expect(writeMethod().params.safeParse({ dir: 'relative/path' }).success).toBe(false)
    expect(() => writeMethod().handler({})).toThrow(
      "The usage report isn't available in this process"
    )
  })
})
