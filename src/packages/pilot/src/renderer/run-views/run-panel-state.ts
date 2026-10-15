import { useSyncExternalStore } from 'react'
import { setPilotAutomationsView } from '../pages/automations-view'
import { pilotStore } from '../store'

// The run the panel shows, and the part it scrolls to (spec §5). One panel, over whichever page is open.
export type OpenRun = { runId: string; part: string | null }

let current: OpenRun | null = null
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

export function openRun(runId: string, part: string | null = null): void {
  current = { runId, part }
  notify()
}

export function closeRunPanel(): void {
  if (current === null) {
    return
  }
  current = null
  notify()
}

export function openRunPanel(): OpenRun | null {
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useOpenRun(): OpenRun | null {
  return useSyncExternalStore(subscribe, openRunPanel, () => null)
}

// The right sidebar is too narrow for the panel: open the Automations page's Activity with the panel over it.
export function openRunFromSidebar(runId: string, part: string | null = null): void {
  setPilotAutomationsView('activity')
  pilotStore()?.getState().openAutomationsPage?.()
  openRun(runId, part)
}
