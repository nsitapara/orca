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
import { capacity, finishedRun } from './__fixtures__/capacity'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))
const activate = vi.fn()
vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorktree: (...args: unknown[]) => activate(...args)
}))

import { FINISHED_WIDTHS_KEY, FinishedRuns } from './FinishedRuns'
import { RunningPage } from './RunningPage'
import { CAPACITY_POLL_MS } from './use-capacity'

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

async function shown(): Promise<void> {
  render(<RunningPage />)
  await act(async () => {})
}

async function click(name: string | RegExp): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}

// Opens Limits & how it works: the page's, or a named machine's within its region.
async function openLimits(scope: Pick<typeof screen, 'getByRole'> = screen): Promise<void> {
  await act(async () => {
    fireEvent.click(scope.getByRole('button', { name: 'Limits & how it works' }))
  })
}

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  window.localStorage.clear()
  vi.unstubAllGlobals()
  registerPilotStore(null)
  activate.mockReset()
})

describe('RunningPage', () => {
  it('lists what runs with its memory and what waits in line, and says how many slots are used', async () => {
    serve(capacity())
    await shown()
    expect(screen.getByText('1 of 2 in use · 1 waiting')).toBeTruthy()
    const running = within(screen.getByRole('region', { name: 'Running now' }))
    expect(running.getByText('03 Review and fix')).toBeTruthy()
    expect(running.queryByRole('button', { name: 'Show tab' })).toBeNull()
    expect(running.getByText(/· 1\.5 GB · peak 2\.0 GB$/)).toBeTruthy()
    const waiting = within(screen.getByRole('region', { name: 'Waiting' }))
    expect(waiting.getByText('05 Fix failed CI')).toBeTruthy()
    expect(waiting.getByText('Run now')).toBeTruthy()
    expect(waiting.getByText('waiting 3m')).toBeTruthy()
    expect(screen.getByText('2 at once')).toBeTruthy()
  })

  it('lists a held item with how long it has been held and why, and says what the quota ceiling holds', async () => {
    const now = Date.now()
    serve(
      capacity({
        quotaCeiling: { weekly: 90, session: 95 },
        queued: [
          {
            automationId: 'review',
            automationName: '03 Review and fix',
            itemKey: 'wt:1',
            itemLabel: 'web-2099',
            queuedAt: now - 9 * 60_000,
            byHand: false,
            dueAt: now - 48 * 60 * 60_000,
            dueFrom: 'oldest new commit',
            holdCode: 'in_flight',
            holdDetail: '53 uncommitted files',
            heldAt: now - 9 * 60_000
          }
        ]
      })
    )
    await shown()
    expect(screen.getByRole('heading', { name: 'Waiting \u00b7 1' })).toBeTruthy()
    const waiting = within(screen.getByRole('region', { name: 'Waiting' }))
    expect(
      waiting.getByText(/^53 uncommitted files\. It starts once the worktree is clean/)
    ).toBeTruthy()
    expect(waiting.getByText('held 9m \u00b7 oldest new commit 48h ago')).toBeTruthy()
    await openLimits()
    expect(
      screen.getByText(
        'Jobs with an agent step wait while Claude or Codex is over 90% weekly or 95% session.'
      )
    ).toBeTruthy()
  })

  it('places only the rows waiting on a slot in line, and marks the others held', async () => {
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
    const [held, slot] = within(screen.getByRole('region', { name: 'Waiting' }))
      .getAllByRole('listitem')
      .map((li) => within(li))
    expect(held?.getByText('Held · Agent quota')).toBeTruthy()
    expect(held?.queryByText(/in line$/)).toBeNull()
    expect(slot?.getByText('#1 in line')).toBeTruthy()
    expect(slot?.queryByText(/^Held/)).toBeNull()
  })

  it('renders an older payload without hold fields, the quota ceiling or retries', async () => {
    serve(capacity({ finished: [finishedRun({ onceKey: undefined })] }))
    await shown()
    await openLimits()
    expect(screen.queryByText(/over \d+% weekly/)).toBeNull()
    expect(screen.queryByText('Agent quota ceiling')).toBeNull()
    expect(screen.queryByText('Retries after a failure')).toBeNull()
    expect(screen.queryByRole('region', { name: 'Gave up' })).toBeNull()
    await click('Recently finished · 1')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('steps the retries after a failure, 0 to 5', async () => {
    serve(capacity({ retryLimit: 2 }))
    await shown()
    await openLimits()
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

  // Continue run goes on where a run broke, a stopped one included; Retry runs a failed or stopped run's item afresh.
  it.each<[string, Partial<FinishedRun>, number, number]>([
    ['a failed run with its failed key', { status: 'failed', onceKey: '1' }, 1, 1],
    ['a timed-out run with its failed key', { status: 'timed_out', onceKey: '1' }, 1, 1],
    ['a stopped run with its key', { status: 'cancelled', onceKey: '1' }, 1, 1],
    ['a cancelled run with no key', { status: 'cancelled' }, 0, 1],
    ['an ask-first run you declined', { status: 'cancelled', trigger: 'ask_first' }, 0, 0],
    ['a done run', { status: 'done' }, 0, 0],
    ['a failed run with no failed key', { status: 'failed' }, 0, 1]
  ])('offers Retry and Continue run on %s', async (_name, over, retries, continues) => {
    serve(capacity({ finished: [finishedRun(over)] }))
    await shown()
    await click('Recently finished · 1')
    const row = within(
      within(screen.getByRole('region', { name: 'Recently finished' })).getAllByRole('row')[1]
    )
    expect(row.queryAllByRole('button', { name: 'Continue run' })).toHaveLength(continues)
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
  })

  it.each([
    ['More jobs at once', 2, 3],
    ['Fewer jobs at once', 2, 1],
    ['More jobs at once', 10, null],
    ['Fewer jobs at once', null, 10]
  ] as const)('%s from %s sets %s at once', async (button, from, to) => {
    serve(capacity({ limit: from }))
    await shown()
    await openLimits()
    await click(button)
    expect(pilotRpc).toHaveBeenCalledWith('pilot.capacity.setLimit', { limit: to })
    expect(screen.getByRole('status', { name: 'Jobs at once' }).textContent).toBe(
      to === null ? 'No limit' : String(to)
    )
  })

  it('uses the suggestion, and offers it only while the limit differs', async () => {
    serve(capacity())
    await shown()
    await openLimits()
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
    await openLimits()
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

  it('folds the limits behind Limits & how it works, with who handles what', async () => {
    serve(capacity({ retryLimit: 2, quotaCeiling: { weekly: 90, session: 95 } }))
    await shown()
    expect(screen.getByText('2 at once · 2 retries · quota stops at 90% / 95%')).toBeTruthy()
    expect(screen.queryByRole('status', { name: 'Jobs at once' })).toBeNull()
    await openLimits()
    const toggle = screen.getByRole('button', { name: 'Limits & how it works' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const panel = within(screen.getByRole('region', { name: 'Limits and how it works' }))
    expect(panel.getByRole('status', { name: 'Jobs at once' }).textContent).toBe('2')
    expect(
      ["Pilot's runner", 'The job file', 'The skill'].map((t) => !!panel.getByText(t))
    ).toEqual([true, true, true])
  })

  it('says what each check holds now, from the waiting rows', async () => {
    const now = Date.now()
    serve(
      capacity({
        quotaCeiling: { weekly: 90, session: 95 },
        quotaUse: { claude: { weekly: 92, session: 10 } },
        queued: [
          {
            automationId: 'context',
            automationName: '14 Prepare context',
            itemKey: 'card-1',
            itemLabel: 'F4',
            queuedAt: now,
            byHand: false,
            holdCode: 'quota',
            holdDetail: 'claude weekly limit at 92% (jobs stop at 90%)'
          }
        ]
      })
    )
    await shown()
    await openLimits()
    await click(/^Every check before a run starts, in order/)
    const quota = screen.getByRole('cell', { name: 'Agent quota' }).closest('tr')
    expect(quota && within(quota).getByText('holding 1: Claude 92% weekly')).toBeTruthy()
    expect(screen.getByText('1 of 2 used')).toBeTruthy()
  })

  it('says where a running run works and why, and what a finished run brought home', async () => {
    const [first] = capacity().running
    serve(
      capacity({
        running: [
          { ...first, place: { mode: 'throwaway', reason: 'uncommitted changes', stack: true } }
        ],
        finished: [
          finishedRun({
            place: { mode: 'throwaway', reason: 'uncommitted changes', stack: false },
            home: {
              mergedBack: { ok: false, reason: 'uncommitted changes' },
              kept: 'pilot/review-1'
            }
          })
        ]
      })
    )
    await shown()
    const running = within(screen.getByRole('region', { name: 'Running now' }))
    expect(running.getByText('In a throwaway · own stack')).toBeTruthy()
    expect(running.getByText('Why a throwaway: uncommitted changes')).toBeTruthy()
    await click('Recently finished · 1')
    expect(
      screen.getByText(
        'Worked in a throwaway. Merge back skipped: uncommitted changes. Kept on pilot/review-1 for job 15 to merge back.'
      )
    ).toBeTruthy()
  })

  it('names the project and worktree a running run is for, and opens the worktree', async () => {
    registerPilotStore({
      getState: () => ({
        rightSidebarOpen: false,
        setRightSidebarOpen: () => {},
        repos: [{ id: 'repo-1', displayName: 'web-platform' }],
        worktreesByRepo: { 'repo-1': [{ id: 'a', path: '/wt/web-2153' }] }
      })
    })
    serve(capacity({ running: [{ ...capacity().running[0], homePath: '/wt/web-2153' }] }))
    await shown()
    const running = within(screen.getByRole('region', { name: 'Running now' }))
    expect(running.getByText('web-platform')).toBeTruthy()
    await act(async () => fireEvent.click(running.getByRole('button', { name: 'web-2153' })))
    await waitFor(() => expect(activate).toHaveBeenCalledWith('a'))
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
    await openLimits(region('MacBook'))
    await openLimits(mini)
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
    await mini.findByText('Nothing is running.')
    await openLimits(region('MacBook'))
    await openLimits(mini)
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
    expect(mini.queryByRole('button', { name: 'Limits & how it works' })).toBeNull()
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
    await openLimits(region('Mac mini'))
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
    await openLimits(region('Mac mini'))
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

  // An older Pilot on the Mac mini has no pilot.runs.stop: its refusal shows on its card, and nothing else breaks.
  it('stops a Mac mini run there, and shows the error a Pilot without Stop gives', async () => {
    const older = (method: string): unknown => {
      if (method === 'pilot.runs.stop') {
        throw new Error('Unknown method: pilot.runs.stop')
      }
      return machine()(method)
    }
    await showMini(machine(), older)
    const running = within(
      within(screen.getByRole('region', { name: 'Mac mini' })).getByRole('region', {
        name: 'Running now'
      })
    )
    await act(async () => fireEvent.click(running.getByRole('button', { name: 'Stop' })))
    await click('Stop run')
    expect(pilotRpc.mock.calls.filter(([m]) => m === 'pilot.runs.stop')).toEqual([
      ['pilot.runs.stop', { runId: 'r1' }, { target: MINI.target }]
    ])
    expect(await running.findByText('Unknown method: pilot.runs.stop')).toBeTruthy()
  })

  it("offers Show tab on this machine's card but not the Mac mini's, whose tab is on that machine", async () => {
    const tab = { worktreePath: '/wt/web-1', tabId: 'tab-1' }
    const withTab = (method: string): unknown =>
      method.startsWith('pilot.capacity')
        ? capacity({ running: capacity().running.map((r) => ({ ...r, tab })) })
        : machine()(method)
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(byHost({ local: withTab, mini: withTab }))
    await shown()
    const running = (name: string) =>
      within(
        within(screen.getByRole('region', { name })).getByRole('region', { name: 'Running now' })
      )
    expect(running('MacBook').getAllByRole('button', { name: 'Show tab' })).toHaveLength(1)
    expect(running('Mac mini').queryByRole('button', { name: 'Show tab' })).toBeNull()
  })

  it('continues a Mac mini finished run there', async () => {
    const finished = await showMini()
    await act(async () => {
      fireEvent.click(finished.getByRole('button', { name: 'Continue run' }))
    })
    expect(pilotRpc.mock.calls.filter(([m]) => m === 'pilot.runs.continue')).toEqual([
      ['pilot.runs.continue', { runId: 'f1' }, { target: MINI.target }]
    ])
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
