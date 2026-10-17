// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

import {
  useAutomationsActive,
  useOpenAutomations,
  useOpenAutomationsPage,
  WaitingNavItem
} from './waiting-nav'

const card = (id: string, type: string): Record<string, unknown> => ({
  id,
  type,
  status: 'open',
  title: id
})

function useStore(state: Partial<PilotStoreState>): void {
  registerPilotStore({ getState: () => state as PilotStoreState })
}

describe('waiting nav', () => {
  afterEach(() => {
    cleanup()
    pilotRpc.mockReset()
    registerPilotStore(null)
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
    pilotRpc.mockResolvedValue({
      items: [card('a', 'question'), card('b', 'question'), card('c', 'default')]
    })
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

  it('is current only on the automations page in the waiting view', async () => {
    useStore({ activeView: 'automations' })
    pilotRpc.mockResolvedValue({ items: [] })
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
      pilotRpc.mockResolvedValue({ items: [] })
      render(<WaitingNavItem />)
      const item = screen.getByRole('button', { name: label })
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

  it('hides the pill when the list fails', async () => {
    useStore({ activeView: 'mobile' })
    pilotRpc.mockRejectedValue(new Error('down'))
    render(<WaitingNavItem />)
    await screen.findByRole('button', { name: /Inbox/ })
    await act(async () => {})
    expect(screen.queryByText('0')).toBeNull()
  })
})
