import { describe, expect, it, vi } from 'vitest'
import {
  pilotAutomationsView,
  setPilotAutomationsView,
  subscribePilotAutomationsView
} from './automations-view'

describe('automations view', () => {
  it('starts on automations and notifies only on change', () => {
    expect(pilotAutomationsView()).toBe('automations')
    const listener = vi.fn()
    const off = subscribePilotAutomationsView(listener)
    setPilotAutomationsView('waiting')
    setPilotAutomationsView('waiting')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(pilotAutomationsView()).toBe('waiting')
    off()
    setPilotAutomationsView('automations')
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
