// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapacityPayload, FinishedRun } from '../../../shared/api-types-capacity'
import { testStepRow } from '../../../shared/run-views/__fixtures__/runs'
import { byHost, LOCAL_NAMED, MINI, MINI_OFFLINE } from '../../hosts/__fixtures__/hosts'
import type { PilotHostEntry } from '../../hosts/pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../../hosts/pilot-hosts-feed'
import { openRunPanel } from '../../run-views/run-panel-state'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { RunningPage } from './RunningPage'
import { CAPACITY_POLL_MS } from './use-capacity'

const GIB = 1024 ** 3

function capacity(over: Partial<CapacityPayload> = {}): CapacityPayload {
  const now = Date.now()
  return {
    limit: 2,
    running: [
      {
        id: 'r1',
        automationId: 'review',
        automationName: '03 Review and fix',
        itemLabel: '!1655 web-2235',
        startedAt: now - 5 * 60_000,
        memoryBytes: 1.5 * GIB,
        peakBytes: 2 * GIB,
        counted: true
      }
    ],
    queued: [
      {
        automationId: 'ci',
        automationName: '05 Fix failed CI',
        itemKey: 'mr:9',
        itemLabel: '!9 web-9',
        queuedAt: now - 3 * 60_000,
        byHand: true
      }
    ],
    finished: [],
    memory: { totalBytes: 24 * GIB, availableBytes: 9 * GIB },
    suggestion: { limit: 3, budgetBytes: 6.5 * GIB, perJobBytes: 2 * GIB, measured: true },
    heaviest: {
      automationId: 'review',
      automationName: '03 Review and fix',
      peakBytes: 2 * GIB,
      measured: true
    },
    ...over
  }
}

// The page's poll answers `current`; a change answers what was set. An opened finished run reads its effects and the
// automations' chains.
function serve(current: CapacityPayload): void {
  pilotRpc.mockImplementation(async (method: string, params?: { limit: number | null }) => {
    if (method === 'pilot.capacity.setLimit') {
      return { ...current, limit: params?.limit ?? null }
    }
    if (method === 'pilot.runs.effects') {
      return {}
    }
    if (method === 'pilot.automations.list') {
      return { automations: [], errors: [], peopleError: null, missingDirs: [] }
    }
    return current
  })
}

function finishedRun(over: Partial<FinishedRun> = {}): FinishedRun {
  const now = Date.now()
  return {
    id: 'f1',
    automationId: 'review',
    automationName: '03 Review and fix',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1 web-1',
    worktreePath: '/wt/web-1',
    status: 'failed',
    outcome: 'Merge conflict in api/models.py',
    startedAt: now - 10 * 60_000,
    finishedAt: now - 60_000,
    costUsd: 0.4,
    tokens: null,
    worktreeId: null,
    trigger: 'schedule',
    parentRunId: null,
    imported: false,
    queuedAt: now - 14 * 60_000,
    steps: [],
    inbox: [
      {
        id: 'c1',
        automationId: 'review',
        runId: 'f1',
        stepIdx: 0,
        itemKey: 'mr:1',
        worktreePath: '/wt/web-1',
        person: 'nish',
        type: 'question',
        title: 'Resolve the conflict?',
        context: '',
        status: 'open',
        createdAt: now - 60_000
      }
    ],
    fields: { 'mr.web_url': 'https://gitlab.example/mr/1' },
    peakBytes: 2 * GIB,
    ...over
  }
}

async function shown(): Promise<void> {
  render(<RunningPage />)
  await act(async () => {})
}

async function click(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  vi.unstubAllGlobals()
})

describe('RunningPage', () => {
  it('lists what runs with its memory and what waits in line, and says how many slots are used', async () => {
    serve(capacity())
    await shown()
    expect(screen.getByText('1 of 2 in use · 1 waiting')).toBeTruthy()
    const running = within(screen.getByRole('region', { name: 'Running now' }))
    expect(running.getByText('03 Review and fix')).toBeTruthy()
    expect(running.getByText('1.5 GB · peak 2.0 GB')).toBeTruthy()
    const waiting = within(screen.getByRole('region', { name: 'Waiting for a slot' }))
    expect(waiting.getByText('05 Fix failed CI')).toBeTruthy()
    expect(waiting.getByText('Run now')).toBeTruthy()
    expect(waiting.getByText('waiting 3m')).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Jobs at once' }).textContent).toBe('2')
  })

  it.each([
    ['More jobs at once', 2, 3],
    ['Fewer jobs at once', 2, 1],
    ['More jobs at once', 10, null],
    ['Fewer jobs at once', null, 10]
  ] as const)('%s from %s sets %s at once', async (button, from, to) => {
    serve(capacity({ limit: from }))
    await shown()
    await click(button)
    expect(pilotRpc).toHaveBeenCalledWith('pilot.capacity.setLimit', { limit: to })
    expect(screen.getByRole('status', { name: 'Jobs at once' }).textContent).toBe(
      to === null ? 'No limit' : String(to)
    )
  })

  it('uses the suggestion, and offers it only while the limit differs', async () => {
    serve(capacity())
    await shown()
    expect(screen.getByText(/The heaviest job, 03 Review and fix, peaked at 2\.0 GB/)).toBeTruthy()
    await click('Use 3')
    expect(pilotRpc).toHaveBeenCalledWith('pilot.capacity.setLimit', { limit: 3 })
    expect(screen.queryByRole('button', { name: 'Use 3' })).toBeNull()
  })

  it('shows why a change was refused and keeps the limit it had', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.capacity.setLimit') {
        throw new Error("Pilot isn't running")
      }
      return capacity()
    })
    await shown()
    await click('More jobs at once')
    expect(screen.getByText("Pilot isn't running")).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Jobs at once' }).textContent).toBe('2')
  })

  it('folds the recently finished runs, and a row opens to how it ended and the cards it made', async () => {
    serve(capacity({ finished: [finishedRun()] }))
    await shown()
    const finished = within(screen.getByRole('region', { name: 'Recently finished' }))
    expect(finished.queryByRole('table')).toBeNull()
    await click('Recently finished · 1')
    const row = within(finished.getAllByRole('row')[1])
    expect(row.getByText('03 Review and fix')).toBeTruthy()
    expect(row.getByRole('link', { name: '!1 web-1' }).getAttribute('href')).toBe(
      'https://gitlab.example/mr/1'
    )
    expect(row.getByText('web-1')).toBeTruthy()
    expect(row.getByText('Failed')).toBeTruthy()
    // Waited 4 minutes in line (yellow), ran 9.
    expect(row.getByText('4m').className).toContain('text-status-warning')
    expect(row.getByText('9m')).toBeTruthy()
    expect(row.getByText('2.0 GB')).toBeTruthy()
    expect(screen.queryByText('Merge conflict in api/models.py')).toBeNull()
    await click('Show details of 03 Review and fix')
    expect(screen.getByText('Merge conflict in api/models.py')).toBeTruthy()
    expect(screen.getByText('Resolve the conflict?')).toBeTruthy()
    await click('Open')
    expect(openRunPanel()).toEqual({
      runId: 'f1',
      part: null,
      host: expect.objectContaining({ key: 'local' })
    })
  })

  it.each([
    ['the desktop', false, 1],
    ['the browser version', true, 0]
  ])("offers Resume for a finished run's agent session on %s", async (_where, browser, resumes) => {
    vi.stubGlobal('__ORCA_WEB_CLIENT__', browser)
    serve(capacity({ finished: [finishedRun({ steps: [testStepRow({ runId: 'f1' })] })] }))
    await shown()
    await click('Recently finished · 1')
    const row = within(
      within(screen.getByRole('region', { name: 'Recently finished' })).getAllByRole('row')[1]
    )
    expect(row.queryAllByRole('button', { name: /resume/i })).toHaveLength(resumes)
  })

  it('says when nothing runs or waits', async () => {
    serve(capacity({ running: [], queued: [], limit: null }))
    await shown()
    expect(screen.getByText('0 running, no limit')).toBeTruthy()
    expect(screen.getByText('Nothing is running.')).toBeTruthy()
    expect(screen.getByText('Nothing is waiting.')).toBeTruthy()
  })
})

describe('RunningPage on more than one machine', () => {
  afterEach(() => {
    resetPilotHostsFeed()
    vi.useRealTimers()
  })

  const region = (name: string) => within(screen.getByRole('region', { name }))
  const limitOf = (name: string) =>
    region(name).getByRole('status', { name: 'Jobs at once' }).textContent
  // Each machine answers its own figures; a change answers them with the limit it set.
  const machine = (over: Partial<CapacityPayload>) => (method: string, params?: unknown) =>
    method === 'pilot.capacity.setLimit' && typeof params === 'object' && params !== null
      ? { ...capacity(over), ...params }
      : capacity(over)

  it("shows each machine's runs, queue and run limit under its name", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(
      byHost({ local: machine({}), mini: machine({ running: [], limit: 4 }) })
    )
    render(<RunningPage />)
    const mini = within(await screen.findByRole('region', { name: 'Mac mini' }))
    expect(await mini.findByText('Nothing is running.')).toBeTruthy()
    expect(mini.getByRole('heading', { name: 'Mac mini' })).toBeTruthy()
    expect(mini.getByText('0 of 4 in use · 1 waiting')).toBeTruthy()
    const queue = within(mini.getByRole('region', { name: 'Waiting for a slot' }))
    expect(queue.getByText('05 Fix failed CI')).toBeTruthy()
    const local = within(region('MacBook').getByRole('region', { name: 'Running now' }))
    expect(local.getByText('03 Review and fix')).toBeTruthy()
    expect([limitOf('MacBook'), limitOf('Mac mini')]).toEqual(['2', '4'])
  })

  it('names no machine when this is the only one', async () => {
    setPilotHostsForTests([LOCAL_NAMED])
    pilotRpc.mockImplementation(byHost({ local: machine({}) }))
    render(<RunningPage />)
    expect(await screen.findByText('1 of 2 in use · 1 waiting')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'MacBook' })).toBeNull()
  })

  it("sets a machine's limit on that machine only", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(byHost({ local: machine({}), mini: machine({ running: [] }) }))
    render(<RunningPage />)
    const mini = within(await screen.findByRole('region', { name: 'Mac mini' }))
    const use = await mini.findByRole('button', { name: 'Use 3' })
    await act(async () => {
      fireEvent.click(use)
    })
    expect(pilotRpc).toHaveBeenCalledWith(
      'pilot.capacity.setLimit',
      { limit: 3 },
      { target: MINI.target }
    )
    const localChanges = pilotRpc.mock.calls.filter(
      ([method, , opts]) => method === 'pilot.capacity.setLimit' && opts === undefined
    )
    expect(localChanges).toEqual([])
    expect([limitOf('MacBook'), limitOf('Mac mini')]).toEqual(['2', '3'])
  })

  it('says an unreachable machine is not shown, and that its runs go on there', async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI_OFFLINE])
    pilotRpc.mockImplementation(byHost({ local: machine({}) }))
    render(<RunningPage />)
    expect(await region('MacBook').findByText('1 of 2 in use · 1 waiting')).toBeTruthy()
    const mini = region('Mac mini')
    expect(
      mini.getByText(
        "Mac mini can't be reached, so its runs aren't shown here. They go on running there."
      )
    ).toBeTruthy()
    expect(mini.queryByRole('region', { name: 'Run limit' })).toBeNull()
  })

  type Read = { resolve(p: CapacityPayload): void; reject(e: Error): void; done: boolean }
  const advance = async (ms: number): Promise<void> => {
    await act(() => vi.advanceTimersByTimeAsync(ms))
  }
  const flush = () => advance(0)
  const tick = () => advance(CAPACITY_POLL_MS)
  const hosts = (next: PilotHostEntry[]) => act(() => setPilotHostsForTests(next))

  // Mac mini's reads wait until the test answers the newest one; its change answers at once unless told.
  function miniReads(change: () => unknown = () => capacity({ limit: 3 })) {
    const reads: Read[] = []
    pilotRpc.mockImplementation(
      byHost({
        local: machine({}),
        mini: (method) =>
          method === 'pilot.capacity.setLimit'
            ? change()
            : new Promise<CapacityPayload>((resolve, reject) => {
                reads.push({ resolve, reject, done: false })
              })
      })
    )
    const newest = (): Read => {
      const read = reads.findLast((r) => !r.done)
      if (!read) {
        throw new Error('No read of Mac mini in flight')
      }
      read.done = true
      return read
    }
    return {
      answer: async (p: CapacityPayload) => {
        newest().resolve(p)
        await flush()
      },
      fail: async (error: string) => {
        newest().reject(new Error(error))
        await flush()
      },
      inFlight: () => reads.some((r) => !r.done)
    }
  }
  type MiniReads = ReturnType<typeof miniReads>

  it.each<[string, (mini: MiniReads) => Promise<void>, (mini: MiniReads) => Promise<void>]>([
    ['the read in flight at the change', tick, (mini) => mini.answer(capacity({ limit: 2 }))],
    [
      'a read that fails after it',
      async () => {},
      async (mini) => {
        await tick()
        await mini.fail('timeout')
      }
    ],
    [
      "the machine's empty first read when it comes back",
      async () => {},
      async () => {
        await tick()
        await hosts([LOCAL_NAMED, MINI_OFFLINE])
        await hosts([LOCAL_NAMED, MINI])
      }
    ]
  ])("%s never undoes a machine's new limit", async (_w, before, after) => {
    vi.useFakeTimers()
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    const mini = miniReads()
    render(<RunningPage />)
    await flush()
    await mini.answer(capacity({ limit: 2 }))
    await before(mini)
    await act(async () => {
      fireEvent.click(region('Mac mini').getByRole('button', { name: 'Use 3' }))
    })
    await after(mini)
    expect(limitOf('Mac mini')).toBe('3')
    // A read started after the change does count.
    if (!mini.inFlight()) {
      await tick()
    }
    await mini.answer(capacity({ limit: 3, running: [] }))
    expect(region('Mac mini').getByText('Nothing is running.')).toBeTruthy()
  })

  it("shows a machine's refusal even when a read lands before it", async () => {
    vi.useFakeTimers()
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    let refuse: (e: Error) => void = () => {}
    const mini = miniReads(
      () =>
        new Promise((_resolve, reject) => {
          refuse = reject
        })
    )
    render(<RunningPage />)
    await flush()
    await mini.answer(capacity({ limit: 2 }))
    await act(async () => {
      fireEvent.click(region('Mac mini').getByRole('button', { name: 'Use 3' }))
    })
    await tick()
    await mini.answer(capacity({ limit: 2 }))
    await act(async () => refuse(new Error("Pilot isn't running")))
    expect(region('Mac mini').getByText("Pilot isn't running")).toBeTruthy()
    expect(limitOf('Mac mini')).toBe('2')
  })
})
