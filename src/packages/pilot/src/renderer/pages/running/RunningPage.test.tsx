// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapacityPayload, FinishedRun } from '../../../shared/api-types-capacity'
import { testStepRow } from '../../../shared/run-views/__fixtures__/runs'
import { byHost, LOCAL_NAMED, MINI, MINI_OFFLINE } from '../../hosts/__fixtures__/hosts'
import type { PilotHostEntry } from '../../hosts/pilot-host'
import { PilotHostProvider } from '../../hosts/PilotHostContext'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../../hosts/pilot-hosts-feed'
import { resetAutomationsFeed } from '../../run-views/automations-feed'
import { resetEffectsFeed } from '../../run-views/effects-feed'
import { closeRunPanel, openRunPanel } from '../../run-views/run-panel-state'
import { registerPilotStore } from '../../store'
import { summary } from '../fixtures'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
const activate = vi.fn()
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: (...args: unknown[]) => activate(...args)
}))

import { FINISHED_WIDTHS_KEY, FinishedRuns } from './FinishedRuns'
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
    if (method === 'pilot.capacity.setRetryLimit') {
      return { ...current, retryLimit: params?.limit }
    }
    if (method === 'pilot.capacity.retry') {
      return { ...current, gaveUp: [] }
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
  window.localStorage.clear()
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
    const waiting = within(screen.getByRole('region', { name: 'Waiting' }))
    expect(waiting.getByText('05 Fix failed CI')).toBeTruthy()
    expect(waiting.getByText('Run now')).toBeTruthy()
    expect(waiting.getByText('waiting 3m')).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Jobs at once' }).textContent).toBe('2')
  })

  it('lists a held item with its reason, and says what the quota ceiling holds', async () => {
    const now = Date.now()
    serve(
      capacity({
        quotaCeiling: { weekly: 90, session: 95 },
        queued: [
          {
            automationId: 'ci',
            automationName: '05 Fix failed CI',
            itemKey: 'mr:9',
            itemLabel: '!9 web-9',
            queuedAt: now - 9 * 60_000,
            byHand: false,
            dueAt: now - 3 * 60_000,
            holdCode: 'session_open',
            holdDetail: 'someone is typing in \u2733 F1'
          }
        ]
      })
    )
    await shown()
    expect(screen.getByRole('heading', { name: 'Waiting \u00b7 1' })).toBeTruthy()
    const waiting = within(screen.getByRole('region', { name: 'Waiting' }))
    expect(waiting.getByText('someone is typing in \u2733 F1')).toBeTruthy()
    expect(waiting.getByText('waiting 3m')).toBeTruthy()
    expect(
      screen.getByText(
        'Jobs with an agent step wait while Claude or Codex is over 90% weekly or 95% session.'
      )
    ).toBeTruthy()
  })

  it('numbers only the rows waiting on a slot', async () => {
    const now = Date.now()
    const row = (key: string, over: Partial<CapacityPayload['queued'][number]>) => ({
      automationId: 'ci',
      automationName: 'Fix failed CI',
      itemKey: key,
      itemLabel: key,
      queuedAt: now,
      byHand: false,
      ...over
    })
    serve(
      capacity({
        queued: [
          row('held-one', { holdCode: 'quota', holdDetail: 'over quota' }),
          row('slot-one', { holdCode: 'capacity' })
        ]
      })
    )
    await shown()
    const rows = within(screen.getByRole('region', { name: 'Waiting' })).getAllByRole('listitem')
    expect(rows[0]?.textContent).not.toMatch(/^\d/)
    expect(rows[1]?.textContent).toMatch(/^1/)
  })

  it('renders an older payload without hold fields, the quota ceiling or retries', async () => {
    serve(capacity({ finished: [finishedRun({ onceKey: undefined })] }))
    await shown()
    expect(screen.queryByText(/over \d+% weekly/)).toBeNull()
    expect(screen.queryByText('Retries after a failure')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Gave up' })).toBeNull()
    await click('Recently finished · 1')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('steps the retries after a failure, 0 to 5', async () => {
    serve(capacity({ retryLimit: 2 }))
    await shown()
    expect(screen.getByText('Retries after a failure')).toBeTruthy()
    expect(screen.getByRole('status', { name: 'Retries after a failure' }).textContent).toBe('2')
    await click('More retries after a failure')
    expect(pilotRpc).toHaveBeenCalledWith('pilot.capacity.setRetryLimit', { limit: 3 })
    expect(screen.getByRole('status', { name: 'Retries after a failure' }).textContent).toBe('3')
  })

  it('lists the keys it gave up on, and Retry runs one again', async () => {
    const now = Date.now()
    serve(
      capacity({
        retryLimit: 2,
        gaveUp: [
          {
            automationId: 'review',
            automationName: '03 Review and fix',
            onceKey: '1655:abc',
            itemLabel: '!1655 web-2235',
            failures: 3,
            failedAt: now - 60_000,
            outcome: 'agent exited'
          }
        ]
      })
    )
    await shown()
    expect(screen.getByRole('heading', { name: 'Gave up \u00b7 1' })).toBeTruthy()
    const gaveUp = within(screen.getByRole('region', { name: 'Gave up' }))
    expect(gaveUp.getByText('03 Review and fix')).toBeTruthy()
    expect(gaveUp.getByText('!1655 web-2235')).toBeTruthy()
    expect(gaveUp.getByText('failed 3 times')).toBeTruthy()
    expect(gaveUp.getByText('agent exited')).toBeTruthy()
    await act(async () => {
      fireEvent.click(gaveUp.getByRole('button', { name: 'Retry' }))
    })
    expect(pilotRpc).toHaveBeenCalledWith('pilot.capacity.retry', {
      automationId: 'review',
      onceKey: '1655:abc'
    })
    expect(screen.queryByRole('region', { name: 'Gave up' })).toBeNull()
  })

  it.each([
    ['failed', 'a failed key', '1', 1],
    ['timed_out', 'a failed key', '1', 1],
    ['done', 'no key', undefined, 0],
    ['failed', 'no failed key', undefined, 0]
  ] as const)(
    'offers Retry on a %s finished run with %s',
    async (status, _key, onceKey, retries) => {
      serve(capacity({ finished: [finishedRun({ status, onceKey })] }))
      await shown()
      await click('Recently finished · 1')
      const row = within(
        within(screen.getByRole('region', { name: 'Recently finished' })).getAllByRole('row')[1]
      )
      expect(row.queryAllByRole('button', { name: 'Retry' })).toHaveLength(retries)
      if (retries === 0) {
        return
      }
      await act(async () => {
        fireEvent.click(row.getByRole('button', { name: 'Retry' }))
      })
      expect(pilotRpc).toHaveBeenCalledWith('pilot.capacity.retry', {
        automationId: 'review',
        onceKey: '1'
      })
    }
  )

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
    // Result leads and Ended closes.
    expect(finished.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Details',
      'Result',
      'Job',
      'Item',
      'Worktree',
      'Waited',
      'Ran',
      'Peak memory',
      'Cost',
      'Session',
      'Run',
      'Ended'
    ])
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

  it('widens a finished column by dragging its header edge, and remembers the width', async () => {
    serve(capacity({ finished: [finishedRun()] }))
    await shown()
    await click('Recently finished · 1')
    fireEvent.mouseDown(screen.getByRole('separator', { name: 'Resize Job column' }), {
      clientX: 100
    })
    fireEvent.mouseUp(window, { clientX: 160 })
    // The Job column is the third, after the row toggle and Result.
    expect(document.querySelectorAll('col')[2].style.width).toBe('204px')
    expect(JSON.parse(window.localStorage.getItem(FINISHED_WIDTHS_KEY) ?? '{}')).toEqual({
      job: 204
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

  it("disables a finished run's Retry while a change is saving", async () => {
    serve(capacity({ finished: [finishedRun({ onceKey: '1' })] }))
    const served = pilotRpc.getMockImplementation()
    pilotRpc.mockImplementation((method: string, params?: unknown) =>
      method === 'pilot.capacity.retry' ? new Promise(() => {}) : served?.(method, params)
    )
    await shown()
    await click('Recently finished · 1')
    await click('Retry')
    expect(screen.getByRole('button', { name: 'Retry' }).hasAttribute('disabled')).toBe(true)
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
    const queue = within(mini.getByRole('region', { name: 'Waiting' }))
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

  it("says an unreachable machine's runs are not shown, without claiming they still run", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI_OFFLINE])
    pilotRpc.mockImplementation(byHost({ local: machine({}) }))
    render(<RunningPage />)
    expect(await region('MacBook').findByText('1 of 2 in use · 1 waiting')).toBeTruthy()
    const mini = region('Mac mini')
    expect(
      mini.getByText(
        "Mac mini can't be reached. Losing contact doesn't stop its runs; they just aren't visible from here."
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

describe("RunningPage: another machine's runs", () => {
  afterEach(() => {
    closeRunPanel()
    resetPilotHostsFeed()
    resetEffectsFeed()
    resetAutomationsFeed()
    registerPilotStore(null)
    activate.mockReset()
  })

  const REVIEW = { ...summary, id: 'review', name: '03 Review and fix' }
  // Both machines run r1 and finished f1, the same ids; each answers its own figures and effects.
  const machine =
    (effects: Record<string, unknown> = {}) =>
    (method: string): unknown => {
      if (method === 'pilot.runs.effects') {
        return effects
      }
      if (method === 'pilot.automations.list') {
        return { automations: [REVIEW], errors: [], peopleError: null, missingDirs: [] }
      }
      if (method === 'pilot.session.resume') {
        return { action: 'opened', handle: 'term_9' }
      }
      return capacity({ finished: [finishedRun({ steps: [testStepRow({ runId: 'f1' })] })] })
    }
  const miniFinished = async () => {
    const mini = within(await screen.findByRole('region', { name: 'Mac mini' }))
    const finished = within(await mini.findByRole('region', { name: 'Recently finished' }))
    await act(async () => {
      fireEvent.click(await finished.findByRole('button', { name: 'Recently finished · 1' }))
    })
    return finished
  }
  const showMini = (local = machine(), mini = machine()) => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(byHost({ local, mini }))
    render(<RunningPage />)
    return miniFinished()
  }
  const showDetails = async (finished: ReturnType<typeof within>) => {
    await act(async () => {
      fireEvent.click(finished.getByRole('button', { name: 'Show details of 03 Review and fix' }))
    })
  }

  it.each<[string, string, (finished: ReturnType<typeof within>) => Promise<HTMLElement>]>([
    [
      'Running now',
      'r1',
      async () => {
        const mini = within(screen.getByRole('region', { name: 'Mac mini' }))
        return within(mini.getByRole('region', { name: 'Running now' })).getByRole('button', {
          name: 'Open run'
        })
      }
    ],
    ['a finished row', 'f1', async (finished) => finished.getByRole('button', { name: 'Open' })],
    [
      "a finished run's strip, named by its machine",
      'f1',
      async (finished) => {
        await showDetails(finished)
        const strip = await finished.findByRole('list', { name: 'Run f1 on Mac mini' })
        return within(strip).getByRole('button', { name: /1 fix/ })
      }
    ]
  ])(
    'opens a Mac mini run there from %s, though this machine has a run with its id',
    async (_from, runId, control) => {
      const finished = await showMini()
      fireEvent.click(await control(finished))
      expect([openRunPanel()?.runId, openRunPanel()?.host.key]).toEqual([runId, 'env:mini'])
    }
  )

  it("shows a Mac mini finished run's own effects, never this machine's for the same id (Review Focus 1)", async () => {
    const pushed = (target: string) => ({
      kind: 'pushed',
      target,
      url: null,
      count: 1,
      stepIdx: 0,
      at: 1
    })
    const finished = await showMini(
      machine({ f1: [pushed('web-1')] }),
      machine({ f1: [pushed('mini-1')] })
    )
    await showDetails(finished)
    expect(await finished.findByText('pushed mini-1')).toBeTruthy()
    expect(finished.queryByText('pushed web-1')).toBeNull()
  })

  it("resumes a Mac mini finished run's session there", async () => {
    const finished = await showMini()
    await act(async () => {
      fireEvent.click(finished.getByRole('button', { name: /resume/i }))
    })
    expect(pilotRpc.mock.calls.filter(([m]) => m === 'pilot.session.resume')).toEqual([
      ['pilot.session.resume', { runId: 'f1', stepIdx: 0 }, { target: MINI.target }]
    ])
  })

  it("opens a Mac mini finished run's worktree there, though this machine has the same worktree id", async () => {
    registerPilotStore({
      getState: () => ({
        rightSidebarOpen: false,
        setRightSidebarOpen: () => {},
        worktreesByRepo: {
          'repo-1': [
            { id: 'a', path: '/wt/web-1' },
            { id: 'a', path: '/wt/web-1', runtimeOwnerEnvironmentId: 'mini' }
          ]
        }
      })
    })
    pilotRpc.mockResolvedValue({})
    render(
      <PilotHostProvider host={MINI}>
        <FinishedRuns runs={[finishedRun()]} now={Date.now()} saving={false} onRetry={() => {}} />
      </PilotHostProvider>
    )
    await click('Recently finished · 1')
    await click('web-1')
    await waitFor(() =>
      expect(activate).toHaveBeenCalledWith('a', { executionHostId: 'runtime:mini' })
    )
    expect(activate).toHaveBeenCalledTimes(1)
  })
})
