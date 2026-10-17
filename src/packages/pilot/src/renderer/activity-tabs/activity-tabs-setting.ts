import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { pilotStore } from '../store'

const KEY = 'pilot.activity.show-all-tabs'
const listeners = new Set<() => void>()
let enabled: boolean | null = null

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

function current(): boolean {
  enabled ??= read()
  return enabled
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useActivityShowAllTabs(): boolean {
  return useSyncExternalStore(subscribe, current, () => false)
}

// Turning it on opens Activity, where the tabs now live.
export function setActivityShowAllTabs(next: boolean): void {
  enabled = next
  try {
    window.localStorage.setItem(KEY, String(next))
  } catch {
    // Private windows and blocked storage: the choice just doesn't persist.
  }
  if (next) {
    const state = useAppStore.getState()
    state.setSidebarBody('agents')
    state.setSidebarOpen(true)
  }
  for (const listener of listeners) {
    listener()
  }
}

// Activity replaces the tab strips only while it is the open sidebar; inert until Pilot attaches.
export function useActivityTabsVisible(): boolean {
  const on = useActivityShowAllTabs()
  const showsActivity = useAppStore((s) => s.sidebarOpen && s.sidebarBody === 'agents')
  return on && showsActivity && pilotStore() !== null
}
