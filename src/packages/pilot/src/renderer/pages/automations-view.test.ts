// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearPendingInboxCard,
  pendingInboxCard,
  pilotAutomationsView,
  pilotAutomationTab,
  pilotOpenAutomation,
  setPilotAutomationsView,
  setPilotOpenAutomation,
  showActivity,
  showInboxCard,
  showPilotAutomation,
  subscribePilotAutomationsView,
  takeActivityFilter,
  usePendingActivityFilter,
  usePendingInboxCard
} from './automations-view'

describe('automations view', () => {
  afterEach(() => {
    clearPendingInboxCard()
    takeActivityFilter()
    setPilotOpenAutomation(null)
    setPilotAutomationsView('automations')
  })

  it('starts on automations and notifies only on change', () => {
    expect(pilotAutomationsView()).toBe('automations')
    const listener = vi.fn()
    const off = subscribePilotAutomationsView(listener)
    setPilotAutomationsView('inbox')
    setPilotAutomationsView('inbox')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(pilotAutomationsView()).toBe('inbox')
    off()
    setPilotAutomationsView('automations')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('opens an automation on the tab it is asked for, and a newly opened one on How it runs', () => {
    showPilotAutomation('fix-ci', 'activity')
    expect([pilotAutomationsView(), pilotOpenAutomation(), pilotAutomationTab()]).toEqual([
      'automations',
      'fix-ci',
      'activity'
    ])
    setPilotOpenAutomation('other')
    expect(pilotAutomationTab()).toBe('how')
    setPilotOpenAutomation(null)
  })

  it('opens the Inbox with a card to pick, and Activity with a filter, each taken once', () => {
    showInboxCard('c1')
    expect([pilotAutomationsView(), pendingInboxCard()]).toEqual(['inbox', 'c1'])
    clearPendingInboxCard()
    expect(pendingInboxCard()).toBeNull()
    showActivity(['fix-ci'])
    expect(pilotAutomationsView()).toBe('activity')
    expect(takeActivityFilter()).toEqual(['fix-ci'])
    expect(takeActivityFilter()).toBeNull()
    setPilotAutomationsView('automations')
  })

  it('wakes a mounted Inbox on each card, even the one it already took, and Activity likewise', () => {
    setPilotAutomationsView('inbox')
    const card = renderHook(() => usePendingInboxCard())
    act(() => showInboxCard('c1'))
    expect(card.result.current).toBe('c1')
    act(() => clearPendingInboxCard())
    expect(card.result.current).toBeNull()
    act(() => showInboxCard('c1'))
    expect(card.result.current).toBe('c1')
    card.unmount()

    setPilotAutomationsView('activity')
    const filter = renderHook(() => usePendingActivityFilter())
    act(() => showActivity(['a']))
    expect(filter.result.current).toEqual(['a'])
    act(() => showActivity(['b']))
    expect(filter.result.current).toEqual(['b'])
    act(() => {
      takeActivityFilter()
    })
    expect(filter.result.current).toBeNull()
    act(() => showActivity(['a']))
    expect(filter.result.current).toEqual(['a'])
    filter.unmount()
  })
})
