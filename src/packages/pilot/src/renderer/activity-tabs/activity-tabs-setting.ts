import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { pilotStore } from '../store'

// One of Activity's remembered View options.
function localFlag(key: string) {
  const listeners = new Set<() => void>()
  let enabled: boolean | null = null
  const read = (): boolean => {
    try {
      return window.localStorage.getItem(key) === 'true'
    } catch {
      return false
    }
  }
  const current = (): boolean => {
    enabled ??= read()
    return enabled
  }
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    useValue: (): boolean => useSyncExternalStore(subscribe, current, () => false),
    set(next: boolean): void {
      enabled = next
      try {
        window.localStorage.setItem(key, String(next))
      } catch {
        // Private windows and blocked storage: the choice just doesn't persist.
      }
      for (const listener of listeners) {
        listener()
      }
    }
  }
}

const showAllTabs = localFlag('pilot.activity.show-all-tabs')
const showRecentWorktrees = localFlag('pilot.activity.show-recent-worktrees')

export function useActivityShowAllTabs(): boolean {
  return showAllTabs.useValue()
}

// Turning it on opens Activity, where the tabs now live.
export function setActivityShowAllTabs(next: boolean): void {
  showAllTabs.set(next)
  if (next) {
    const state = useAppStore.getState()
    state.setSidebarBody('agents')
    state.setSidebarOpen(true)
  }
}

export function useActivityShowRecentWorktrees(): boolean {
  return showRecentWorktrees.useValue()
}

export function setActivityShowRecentWorktrees(next: boolean): void {
  showRecentWorktrees.set(next)
}

// Pilot's Activity rows show only in the open Activity sidebar; inert until Pilot attaches.
export function useActivitySidebarAttached(): boolean {
  const showsActivity = useAppStore((s) => s.sidebarOpen && s.sidebarBody === 'agents')
  return showsActivity && pilotStore() !== null
}

export function useActivityTabsVisible(): boolean {
  const on = useActivityShowAllTabs()
  return useActivitySidebarAttached() && on
}

export function useActivityRecentWorktreesVisible(): boolean {
  const on = useActivityShowRecentWorktrees()
  return useActivitySidebarAttached() && on
}
