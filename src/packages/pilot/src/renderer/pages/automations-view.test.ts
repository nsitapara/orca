import { describe, expect, it, vi } from 'vitest'
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
  takeActivityFilter
} from './automations-view'

describe('automations view', () => {
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
})
