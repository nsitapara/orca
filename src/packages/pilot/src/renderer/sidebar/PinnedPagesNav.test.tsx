// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { byHost, LOCAL_NAMED, MINI, MINI_OFFLINE } from '../hosts/__fixtures__/hosts'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../hosts/pilot-hosts-feed'
import {
  pilotAutomationsView,
  pilotOpenAutomation,
  setPilotAutomationsView,
  setPilotOpenAutomation
} from '../pages/automations-view'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import type { TopLevelView } from '../../../../../shared/ui-chrome-types'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({
  pilotRpc: (...args: unknown[]) => pilotRpc(...args)
}))

import { useCapacityTotals } from '../pages/running/use-capacity'
import { PinnedPagesNav, useWaitingTotal } from './PinnedPagesNav'

const card = (id: string, type: string): Record<string, unknown> => ({
  id,
  type,
  status: 'open',
  title: id
})

// Each method gets its own answer; capacity defaults to nothing running or waiting.
function answer(
  inbox: unknown[],
  capacity: { running?: unknown[]; queued?: unknown[] } = {}
): void {
  pilotRpc.mockImplementation(async (method: string) =>
    method === 'pilot.capacity.get' ? { running: [], queued: [], ...capacity } : { items: inbox }
  )
}

const openAutomationsPage = vi.fn()
const openTaskPage = vi.fn()

function useStore(state: { activeView?: TopLevelView; settings?: Partial<GlobalSettings> }): void {
  useAppStore.setState({
    activeView: state.activeView ?? 'terminal',
    settings: { ...getDefaultSettings('/tmp'), ...state.settings },
    openAutomationsPage,
    openTaskPage
  })
}

const rowNames = (): string[] =>
  screen.getAllByRole('button').map((row) => row.textContent?.replace(/\d+/g, '') ?? '')

describe('pinned pages nav', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    openAutomationsPage.mockReset()
    openTaskPage.mockReset()
    resetPilotHostsFeed()
    setPilotAutomationsView('automations')
    setPilotOpenAutomation(null)
  })

  it('shows the count, and click opens the waiting view', async () => {
    useStore({ activeView: 'mobile' })
    answer([card('a', 'question'), card('b', 'question'), card('c', 'default')])
    render(<PinnedPagesNav />)
    const button = await screen.findByRole('button', {
      name: /Inbox/
    })
    expect(await screen.findByText('2')).toBeTruthy()
    expect(button.getAttribute('aria-current')).toBeNull()
    fireEvent.click(button)
    expect(pilotAutomationsView()).toBe('inbox')
    expect(openAutomationsPage).toHaveBeenCalledTimes(1)
  })

  it("counts every machine's waiting cards", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(
      byHost({
        local: () => ({ items: [card('a', 'question')] }),
        mini: () => ({ items: [card('a', 'question'), card('b', 'flagged'), card('c', 'default')] })
      })
    )
    const { result } = renderHook(() => useWaitingTotal())
    await waitFor(() => expect(result.current).toBe(3))
  })

  it('is current only on the automations page in the waiting view', async () => {
    useStore({ activeView: 'automations' })
    answer([])
    render(<PinnedPagesNav />)
    const button = screen.getByRole('button', { name: /Inbox/ })
    expect(button.getAttribute('aria-current')).toBeNull()
    act(() => setPilotAutomationsView('inbox'))
    expect(button.getAttribute('aria-current')).toBe('page')
    expect(
      screen.getByRole('button', { name: /^Automations/ }).getAttribute('aria-current')
    ).toBeNull()
  })

  it('Automations lands on its list, closing an open automation', () => {
    useStore({})
    answer([])
    setPilotOpenAutomation('fix-failed-ci')
    setPilotAutomationsView('inbox')
    render(<PinnedPagesNav />)
    fireEvent.click(screen.getByRole('button', { name: /^Automations/ }))
    expect(pilotOpenAutomation()).toBeNull()
    expect(pilotAutomationsView()).toBe('automations')
    expect(openAutomationsPage).toHaveBeenCalledTimes(1)
  })

  // Why: the sidebar lists the pinned pages, in page order, and the open page while it's open.
  it.each([
    { pinned: undefined, view: 'terminal', rows: ['Inbox', 'Running', 'Automations'] },
    { pinned: [], view: 'terminal', rows: [] },
    { pinned: ['playground', 'tasks'], view: 'terminal', rows: ['Tasks', 'Playground'] },
    { pinned: [], view: 'tasks', rows: ['Tasks'] },
    { pinned: ['inbox'], view: 'automations', rows: ['Inbox', 'Automations'] }
  ] as const)('pinned $pinned on $view shows $rows', ({ pinned, view, rows }) => {
    useStore({
      activeView: view,
      settings: pinned ? { pilotPinnedPages: [...pinned] } : {}
    })
    answer([])
    render(<PinnedPagesNav />)
    expect(screen.queryAllByRole('button').length ? rowNames() : []).toEqual(rows)
  })

  it.each([
    ['Playground', 'playground'],
    ['Running', 'running']
  ] as const)(
    'has a %s item that opens its view, where neither Inbox nor Automations is current',
    async (label, view) => {
      useStore({
        activeView: 'automations',
        settings: { pilotPinnedPages: ['inbox', 'running', 'playground'] }
      })
      answer([])
      render(<PinnedPagesNav />)
      const item = screen.getByRole('button', {
        name: new RegExp(`^${label}`)
      })
      expect(item.getAttribute('aria-current')).toBeNull()
      act(() => fireEvent.click(item))
      expect(pilotAutomationsView()).toBe(view)
      expect(openAutomationsPage).toHaveBeenCalledTimes(1)
      expect(item.getAttribute('aria-current')).toBe('page')
      expect(screen.getByRole('button', { name: /Inbox/ }).getAttribute('aria-current')).toBeNull()
    }
  )

  it.each([
    ['nothing running or waiting', 0, 0, []],
    ['only running', 2, 0, ['2']],
    ['running and waiting, waiting in yellow', 1, 3, ['1', '3']]
  ] as const)('the Running item shows %s', async (_case, running, queued, shown) => {
    useStore({ activeView: 'mobile' })
    answer([], {
      running: Array.from({ length: running }, (_, i) => ({ id: `r${i}` })),
      queued: Array.from({ length: queued }, (_, i) => ({
        itemKey: `q${i}`
      }))
    })
    render(<PinnedPagesNav />)
    const item = screen.getByRole('button', { name: /^Running/ })
    await act(async () => {})
    const pills = [...item.querySelectorAll('span[title]')]
    expect(pills.map((p) => p.textContent)).toEqual(shown)
    const waiting = item.querySelector('span[title="Waiting"]')
    expect(waiting?.className.includes('text-status-warning') ?? false).toBe(queued > 0)
  })

  const runs = (n: number): unknown[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }))
  // Each machine answers the inbox list empty, and capacity as given.
  const capacityBy = (answers: Record<string, () => unknown>): void => {
    pilotRpc.mockImplementation(
      byHost(
        Object.fromEntries(
          Object.entries(answers).map(([key, cap]) => [
            key,
            (method: string) => (method === 'pilot.capacity.get' ? cap() : { items: [] })
          ])
        )
      )
    )
  }
  const pillTexts = (): (string | null)[] => {
    const item = screen.getByRole('button', { name: /^Running/ })
    return [...item.querySelectorAll('span[title]')].map((p) => p.textContent)
  }

  it("sums every machine's running and waiting runs", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    capacityBy({
      local: () => ({ running: runs(1), queued: [] }),
      mini: () => ({ running: runs(2), queued: runs(1) })
    })
    const { result } = renderHook(() => useCapacityTotals())
    await waitFor(() => expect(result.current).toEqual({ running: 3, queued: 1 }))
  })

  it('an offline machine counts nothing', async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI_OFFLINE])
    capacityBy({ local: () => ({ running: runs(1), queued: [] }) })
    const { result } = renderHook(() => useCapacityTotals())
    await waitFor(() => expect(result.current).toEqual({ running: 1, queued: 0 }))
  })

  it("a failed read keeps that machine's last figures", async () => {
    vi.useFakeTimers()
    try {
      useStore({ activeView: 'mobile' })
      let calls = 0
      pilotRpc.mockImplementation(async (method: string) => {
        if (method !== 'pilot.capacity.get') {
          return { items: [] }
        }
        calls += 1
        if (calls > 1) {
          throw new Error('down')
        }
        return { running: runs(2), queued: [] }
      })
      render(<PinnedPagesNav />)
      await act(async () => {})
      expect(pillTexts()).toEqual(['2'])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_100)
      })
      expect(calls).toBeGreaterThan(1)
      expect(pillTexts()).toEqual(['2'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('hides the pill when the list fails', async () => {
    useStore({ activeView: 'mobile' })
    pilotRpc.mockRejectedValue(new Error('down'))
    render(<PinnedPagesNav />)
    await screen.findByRole('button', { name: /Inbox/ })
    await act(async () => {})
    expect(screen.queryByText('0')).toBeNull()
  })
})
