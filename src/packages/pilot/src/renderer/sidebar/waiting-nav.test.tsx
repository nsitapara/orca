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
import { registerPilotStore, type PilotStoreState } from '../store'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({
  pilotRpc: (...args: unknown[]) => pilotRpc(...args)
}))

import { useCapacityTotals } from '../pages/running/use-capacity'
import {
  useAutomationsActive,
  useOpenAutomations,
  useOpenAutomationsPage,
  useWaitingTotal,
  WaitingNavItem
} from './waiting-nav'

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

function useStore(state: Partial<PilotStoreState>): void {
  registerPilotStore({ getState: () => state as PilotStoreState })
}

describe('waiting nav', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    registerPilotStore(null)
    resetPilotHostsFeed()
    setPilotAutomationsView('automations')
    setPilotOpenAutomation(null)
  })

  it('shows the list when Automations is clicked while an automation is open', () => {
    const open = vi.fn()
    setPilotOpenAutomation('fix-failed-ci')
    const click = renderHook(() =>
      useOpenAutomationsPage((select) => select({ openAutomationsPage: open }) as never)
    ).result.current
    click()
    expect(pilotOpenAutomation()).toBeNull()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('does nothing without a store', () => {
    const { container } = render(<WaitingNavItem />)
    expect(container.innerHTML).toBe('')
    expect(pilotRpc).not.toHaveBeenCalled()
    expect(renderHook(() => useAutomationsActive(true)).result.current).toBe(true)
    const open = vi.fn()
    renderHook(() => useOpenAutomations(open)).result.current()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('shows the count, and click opens the waiting view', async () => {
    const openAutomationsPage = vi.fn()
    useStore({ activeView: 'mobile', openAutomationsPage })
    answer([card('a', 'question'), card('b', 'question'), card('c', 'default')])
    render(<WaitingNavItem />)
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
    render(<WaitingNavItem />)
    const button = screen.getByRole('button', { name: /Inbox/ })
    expect(button.getAttribute('aria-current')).toBeNull()
    act(() => setPilotAutomationsView('inbox'))
    expect(button.getAttribute('aria-current')).toBe('page')
    expect(renderHook(() => useAutomationsActive(true)).result.current).toBe(false)
  })

  it.each([
    ['Playground', 'playground'],
    ['Running', 'running']
  ] as const)(
    'has a %s item that opens its view, where neither Inbox nor Automations is current',
    async (label, view) => {
      const openAutomationsPage = vi.fn()
      useStore({ activeView: 'automations', openAutomationsPage })
      answer([])
      render(<WaitingNavItem />)
      const item = screen.getByRole('button', {
        name: new RegExp(`^${label}`)
      })
      expect(item.getAttribute('aria-current')).toBeNull()
      act(() => fireEvent.click(item))
      expect(pilotAutomationsView()).toBe(view)
      expect(openAutomationsPage).toHaveBeenCalledTimes(1)
      expect(item.getAttribute('aria-current')).toBe('page')
      expect(screen.getByRole('button', { name: /Inbox/ }).getAttribute('aria-current')).toBeNull()
      expect(renderHook(() => useAutomationsActive(true)).result.current).toBe(false)
    }
  )

  it('the wrapped open leaves the waiting view first', () => {
    setPilotAutomationsView('inbox')
    const open = vi.fn(() => expect(pilotAutomationsView()).toBe('automations'))
    const { result } = renderHook(() => useOpenAutomations(open))
    result.current()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('is hidden when the Automations button is hidden', () => {
    useStore({ settings: { showAutomationsButton: false } })
    const { container } = render(<WaitingNavItem />)
    expect(container.innerHTML).toBe('')
    expect(pilotRpc).not.toHaveBeenCalled()
  })

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
    render(<WaitingNavItem />)
    const item = screen.getByRole('button', { name: /^Running/ })
    await act(async () => {})
    const pills = [...item.querySelectorAll('span[title]')]
    expect(pills.map((p) => p.textContent)).toEqual(shown)
    const waiting = item.querySelector('span[title="Waiting for a slot"]')
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
      render(<WaitingNavItem />)
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
    render(<WaitingNavItem />)
    await screen.findByRole('button', { name: /Inbox/ })
    await act(async () => {})
    expect(screen.queryByText('0')).toBeNull()
  })
})
