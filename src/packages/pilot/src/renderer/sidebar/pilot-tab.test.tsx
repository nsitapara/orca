import { afterEach, describe, expect, it, vi } from 'vitest'
import { handlePilotActivityClick } from './pilot-tab'
import { registerPilotStore } from '../store'

function fakeStore(open: boolean) {
  const setRightSidebarOpen = vi.fn()
  return {
    setRightSidebarOpen,
    store: { getState: () => ({ rightSidebarOpen: open, setRightSidebarOpen }) }
  }
}

describe('handlePilotActivityClick', () => {
  afterEach(() => registerPilotStore(null))

  it('is inert when no store is registered', () => {
    expect(handlePilotActivityClick('checks', 'checks')).toBe(false)
  })

  it.each([
    ['reclick on the open active tab closes', true, 'checks', 'checks', true, [false]],
    [
      'click on a closed panel opens, then lets Orca select',
      false,
      'checks',
      'checks',
      false,
      [true]
    ],
    ['click on another tab while open only selects', true, 'plugin:pilot', 'checks', false, []]
  ])('%s', (_name, open, tab, effective, consumed, calls) => {
    const { store, setRightSidebarOpen } = fakeStore(open)
    registerPilotStore(store)
    expect(handlePilotActivityClick(tab, effective)).toBe(consumed)
    expect(setRightSidebarOpen.mock.calls.map((c) => c[0])).toEqual(calls)
  })
})
