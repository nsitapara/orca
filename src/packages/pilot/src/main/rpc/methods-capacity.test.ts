import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CapacityPayload } from '../../shared/api-types-capacity'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import { EMPTY_PEOPLE } from '../../shared/people'
import type { RunMemorySampler } from '../capacity/run-memory'
import type { PilotContext } from '../pilot-services'
import { PilotStore } from '../store/store'
import { AGENT_SETS_LIMIT, AGENT_SETS_RETRIES, buildCapacityMethods } from './methods-capacity'
import { NO_CALLER_CHANGE } from './run-binding'

type Callable = {
  name: string
  params: { safeParse(v: unknown): { success: boolean } } | null
  handler(p: unknown, rpc?: { caller?: { kind: string } }): Promise<CapacityPayload>
}

const GIB = 1024 ** 3
const NOW = 1_000_000
const FRESH = { totalBytes: 24 * GIB, availableBytes: 9 * GIB }

function setup(sample: ReturnType<RunMemorySampler['snapshot']> | null) {
  const store = PilotStore.open(
    join(mkdtempSync(join(tmpdir(), 'pilot-capacity-rpc-')), 'db.sqlite')
  )
  const tickAll = vi.fn(async () => {})
  const tickNow = vi.fn(async () => ({ status: 'ok' }))
  const readSystem = vi.fn(async () => FRESH)
  const loaded = {
    definitions: [testDefinition({ id: 'review', oncePer: '{mr.iid}' })],
    errors: [],
    people: EMPTY_PEOPLE,
    peopleError: null,
    missingDirs: []
  }
  const ctx = {
    store,
    loaded: () => loaded,
    schedulerOn: true,
    scheduler: { tickAll, tickNow },
    memory: sample ? { snapshot: () => sample } : undefined
  }
  const list = buildCapacityMethods(
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the methods read only store, loaded, memory, scheduler.tickAll/tickNow and schedulerOn.
    () => ctx as unknown as PilotContext,
    readSystem,
    () => NOW
  )
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: defineMethod's objects have name, params and handler; the tests call handlers with valid params.
  const methods = new Map((list as unknown as Callable[]).map((m) => [m.name, m]))
  return { store, tickAll, tickNow, readSystem, method: (name: string) => methods.get(name)! }
}

const DESKTOP = { caller: { kind: 'desktop' } }

describe('pilot.capacity', () => {
  it.each([
    ['no sample', null, FRESH, 1],
    [
      'a stale sample',
      { runs: new Map(), system: { totalBytes: 1, availableBytes: 1 }, sampledAt: NOW - 61_000 },
      FRESH,
      1
    ],
    [
      'a fresh sample',
      {
        runs: new Map(),
        system: { totalBytes: 24 * GIB, availableBytes: 7 * GIB },
        sampledAt: NOW - 5_000
      },
      { totalBytes: 24 * GIB, availableBytes: 7 * GIB },
      0
    ]
  ])('reads memory from %s', async (_name, sample, memory, freshReads) => {
    const { method, readSystem } = setup(sample)
    expect((await method('pilot.capacity.get').handler(null)).memory).toEqual(memory)
    expect(readSystem).toHaveBeenCalledTimes(freshReads)
  })

  it('sets and clears the limit for a person, and starts a loop so queued items go at once', async () => {
    const { store, method, tickAll } = setup(null)
    expect((await method('pilot.capacity.setLimit').handler({ limit: 3 }, DESKTOP)).limit).toBe(3)
    expect(store.capacity.runLimit()).toBe(3)
    expect(
      (await method('pilot.capacity.setLimit').handler({ limit: null }, DESKTOP)).limit
    ).toBeNull()
    expect(tickAll).toHaveBeenCalledTimes(2)
  })

  it('refuses an unknown caller and an agent in a run, leaving the limit as it was', () => {
    const { store, method } = setup(null)
    store.runs.create({
      id: 'r1',
      automationId: 'a',
      tickId: null,
      itemKey: 'k',
      itemLabel: 'k',
      worktreePath: null,
      startedAt: 1
    })
    store.runs.createStep({
      runId: 'r1',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      startedAt: 1
    })
    store.runs.updateStep('r1', 0, { terminalHandle: 'term-1' })
    const setLimit = method('pilot.capacity.setLimit')
    expect(() => setLimit.handler({ limit: 5 }, {})).toThrow(NO_CALLER_CHANGE)
    expect(() =>
      setLimit.handler({ limit: 5, terminal: 'term-1' }, { caller: { kind: 'local-cli' } })
    ).toThrow(AGENT_SETS_LIMIT)
    expect(store.capacity.runLimit()).toBeNull()
  })

  it.each([
    [{ limit: 1 }, true],
    [{ limit: 10 }, true],
    [{ limit: null }, true],
    [{ limit: 0 }, false],
    [{ limit: 11 }, false],
    [{ limit: 2.5 }, false],
    [{}, false]
  ])('setLimit params %o valid: %s', (params, ok) => {
    expect(setup(null).method('pilot.capacity.setLimit').params!.safeParse(params).success).toBe(ok)
  })

  it('sets the retries after a failure for a person, and refuses an agent in a run', async () => {
    const { store, method } = setup(null)
    const set = method('pilot.capacity.setRetryLimit')
    expect((await set.handler({ limit: 4 }, DESKTOP)).retryLimit).toBe(4)
    expect(store.capacity.retryLimit()).toBe(4)
    expect(() => set.handler({ limit: 1 }, {})).toThrow(NO_CALLER_CHANGE)
    expect(store.capacity.retryLimit()).toBe(4)
    expect(AGENT_SETS_RETRIES).toMatch(/can't change how often/)
  })

  it.each([
    [{ limit: 0 }, true],
    [{ limit: 5 }, true],
    [{ limit: -1 }, false],
    [{ limit: 6 }, false],
    [{ limit: null }, false]
  ])('setRetryLimit params %o valid: %s', (params, ok) => {
    expect(
      setup(null).method('pilot.capacity.setRetryLimit').params!.safeParse(params).success
    ).toBe(ok)
  })

  it('retry frees a failed key and ticks its job once with only that key and its item by hand', async () => {
    const { store, method, tickNow } = setup(null)
    store.runs.create({
      id: 'run-1',
      automationId: 'review',
      tickId: null,
      itemKey: 'mr:7',
      itemLabel: '!7',
      worktreePath: null,
      startedAt: 1
    })
    store.markHandled('review', '7', 'run-1', 1)
    store.setHandledStatus('review', 'run-1', 'failed', 2)
    const view = await method('pilot.capacity.retry').handler(
      { automationId: 'review', onceKey: '7' },
      DESKTOP
    )
    expect(store.handledKeys('review')).toEqual(new Set())
    expect(tickNow).toHaveBeenCalledTimes(1)
    expect(tickNow).toHaveBeenCalledWith('review', {
      dryRun: false,
      byHandKeys: new Set(['7', 'mr:7'])
    })
    expect(view.gaveUp).toEqual([])
  })

  it('retry refuses a job it does not know, freeing nothing', () => {
    const { store, method, tickNow } = setup(null)
    store.markHandled('gone', '7', 'run-1', 1)
    store.setHandledStatus('gone', 'run-1', 'failed', 2)
    expect(() =>
      method('pilot.capacity.retry').handler({ automationId: 'gone', onceKey: '7' }, DESKTOP)
    ).toThrow('No automation "gone"')
    expect(store.handledKeys('gone')).toEqual(new Set(['7']))
    expect(tickNow).not.toHaveBeenCalled()
  })
})
