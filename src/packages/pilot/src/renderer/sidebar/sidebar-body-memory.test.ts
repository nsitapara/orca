// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createStore } from 'zustand/vanilla'
import { rememberSidebarBody, SIDEBAR_BODY_KEY } from './sidebar-body-memory'

type Body = 'workspaces' | 'agents'

function upstreamStore() {
  return createStore<{ sidebarBody: Body; setSidebarBody(body: Body): void }>()((set) => ({
    sidebarBody: 'workspaces',
    setSidebarBody: (body) => set({ sidebarBody: body })
  }))
}

afterEach(() => window.localStorage.clear())

describe('rememberSidebarBody', () => {
  it.each([
    { saved: null, opens: 'agents' },
    { saved: 'agents', opens: 'agents' },
    { saved: 'workspaces', opens: 'workspaces' },
    { saved: 'something-else', opens: 'agents' }
  ])('opens on $opens when $saved was saved', ({ saved, opens }) => {
    if (saved) {
      window.localStorage.setItem(SIDEBAR_BODY_KEY, saved)
    }
    const store = upstreamStore()
    rememberSidebarBody(store)
    expect(store.getState().sidebarBody).toBe(opens)
  })

  it('remembers each switch for the next launch', () => {
    const store = upstreamStore()
    const stop = rememberSidebarBody(store)
    store.getState().setSidebarBody('workspaces')
    expect(window.localStorage.getItem(SIDEBAR_BODY_KEY)).toBe('workspaces')
    store.getState().setSidebarBody('agents')
    expect(window.localStorage.getItem(SIDEBAR_BODY_KEY)).toBe('agents')
    stop()
    store.getState().setSidebarBody('workspaces')
    expect(window.localStorage.getItem(SIDEBAR_BODY_KEY)).toBe('agents')
  })
})
