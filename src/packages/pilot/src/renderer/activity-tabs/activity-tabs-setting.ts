import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { pilotStore } from '../store'

type StoredCodec<T> = { parse: (raw: string | null) => T; serialize: (value: T) => string | null }

// A value remembered in localStorage, read once and shared by every reader; null serialized removes it.
export function localValue<T>(key: string, codec: StoredCodec<T>) {
  const listeners = new Set<() => void>()
  let loaded = false
  let value: T
  const read = (): T => {
    try {
      return codec.parse(window.localStorage.getItem(key))
    } catch {
      return codec.parse(null)
    }
  }
  const current = (): T => {
    if (!loaded) {
      value = read()
      loaded = true
    }
    return value
  }
  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
  return {
    useValue: (): T => useSyncExternalStore(subscribe, current, () => codec.parse(null)),
    set(next: T): void {
      value = next
      loaded = true
      try {
        const raw = codec.serialize(next)
        if (raw === null) {
          window.localStorage.removeItem(key)
        } else {
          window.localStorage.setItem(key, raw)
        }
      } catch {
        // Private windows and blocked storage: the choice just doesn't persist.
      }
      for (const listener of listeners) {
        listener()
      }
    }
  }
}

// A remembered on/off choice (off until set): Activity's View options, the sidebar's Artifacts fold-out.
export function localFlag(key: string) {
  return localValue(key, { parse: (raw) => raw === 'true', serialize: String })
}

const showAllTabs = localFlag('pilot.activity.show-all-tabs')
const showRecentWorktrees = localFlag('pilot.activity.show-recent-worktrees')
const hideTerminals = localFlag('pilot.activity.hide-terminals')
const hideAutomationRuns = localFlag('pilot.activity.hide-automation-runs')
const inactiveExpanded = localFlag('pilot.activity.inactive-expanded')

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

// A filter on "Show all tabs": terminal tabs with no agent in them leave the list.
export function useActivityHideTerminals(): boolean {
  return hideTerminals.useValue()
}

export function setActivityHideTerminals(next: boolean): void {
  hideTerminals.set(next)
}

// A filter: sessions and tabs a Pilot automation step ran in leave the list.
export function useActivityHideAutomationRuns(): boolean {
  return hideAutomationRuns.useValue()
}

export function setActivityHideAutomationRuns(next: boolean): void {
  hideAutomationRuns.set(next)
}

// Grouped by worktree, the Inactive section starts folded.
export function useActivityInactiveExpanded(): boolean {
  return inactiveExpanded.useValue()
}

export function setActivityInactiveExpanded(next: boolean): void {
  inactiveExpanded.set(next)
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
