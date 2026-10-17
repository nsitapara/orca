import { useSyncExternalStore } from 'react'
import { LOCAL_PILOT_HOST, type PilotHostRef } from '../hosts/pilot-host'
import { setPilotAutomationsView } from '../pages/automations-view'
import { pilotStore } from '../store'

// The run the panel shows, the part it scrolls to (spec §5), and the machine it ran on. One panel, over whichever page
// is open.
export type OpenRun = { runId: string; part: string | null; host: PilotHostRef }

let current: OpenRun | null = null
const listeners = new Set<() => void>()

function notify(): void {
  listeners.forEach((listener) => listener())
}

// Run ids are per machine, so a run opens on its own machine; none is this machine.
export function openRun(
  runId: string,
  part: string | null = null,
  host: PilotHostRef = LOCAL_PILOT_HOST
): void {
  current = { runId, part, host }
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

// The right sidebar is too narrow for the panel: open the Automations page's Activity with the panel over it. The
// sidebar's worktree timeline is this machine's, so its runs are too.
export function openRunFromSidebar(runId: string, part: string | null = null): void {
  setPilotAutomationsView('activity')
  pilotStore()?.getState().openAutomationsPage?.()
  openRun(runId, part)
}
