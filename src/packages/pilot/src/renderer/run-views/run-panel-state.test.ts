import { afterEach, describe, expect, it, vi } from 'vitest'
import { pilotAutomationsView, setPilotAutomationsView } from '../pages/automations-view'
import { registerPilotStore } from '../store'
import { closeRunPanel, openRun, openRunFromSidebar, openRunPanel } from './run-panel-state'

describe('the run panel', () => {
  afterEach(() => {
    closeRunPanel()
    setPilotAutomationsView('automations')
    registerPilotStore(null)
  })

  it('opens one run at a time, at a part, and closes', () => {
    openRun('r1', 'step:1')
    expect(openRunPanel()).toEqual({
      runId: 'r1',
      part: 'step:1',
      host: expect.objectContaining({ key: 'local' })
    })
    openRun('r2')
    expect(openRunPanel()).toEqual({
      runId: 'r2',
      part: null,
      host: expect.objectContaining({ key: 'local' })
    })
    closeRunPanel()
    expect(openRunPanel()).toBeNull()
  })

  it("opens a run from the sidebar over the Automations page's Activity", () => {
    const openAutomationsPage = vi.fn()
    registerPilotStore({
      getState: () => ({
        rightSidebarOpen: true,
        setRightSidebarOpen: () => {},
        openAutomationsPage
      })
    })
    openRunFromSidebar('r3', 'step:0')
    expect(pilotAutomationsView()).toBe('activity')
    expect(openAutomationsPage).toHaveBeenCalled()
    expect(openRunPanel()).toEqual({
      runId: 'r3',
      part: 'step:0',
      host: expect.objectContaining({ key: 'local' })
    })
  })
})
