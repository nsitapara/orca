import { useSyncExternalStore } from 'react'

// Which sub-view the Automations page shows. The sidebar's "Inbox" item flips it.
export type PilotAutomationsView = 'automations' | 'inbox'

let current: PilotAutomationsView = 'automations'
let openId: string | null = null
// A job of several automations, by its job.id. A stage opened from the job's page keeps it set underneath.
let openJobId: string | null = null
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function pilotAutomationsView(): PilotAutomationsView {
  return current
}

// Switching view also closes an open automation, so coming back lands on the list.
export function setPilotAutomationsView(next: PilotAutomationsView): void {
  if (next === current) {
    return
  }
  current = next
  openId = null
  openJobId = null
  notify()
}

export function pilotOpenAutomation(): string | null {
  return openId
}

export function setPilotOpenAutomation(id: string | null): void {
  if (id === openId) {
    return
  }
  openId = id
  notify()
}

export function pilotOpenJob(): string | null {
  return openJobId
}

export function setPilotOpenJob(id: string | null): void {
  if (id === openJobId) {
    return
  }
  openJobId = id
  notify()
}

// The breadcrumbs: the list, or a job's page, from whichever page is open (a stage opened from its job keeps the job
// open underneath, so closing the stage alone would land on the job).
export function showPilotAutomationsList(): void {
  if (openId === null && openJobId === null) {
    return
  }
  openId = null
  openJobId = null
  notify()
}

export function showPilotJob(id: string): void {
  if (openId === null && openJobId === id) {
    return
  }
  openId = null
  openJobId = id
  notify()
}

export function subscribePilotAutomationsView(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function usePilotAutomationsView(): PilotAutomationsView {
  return useSyncExternalStore(subscribePilotAutomationsView, pilotAutomationsView)
}

export function usePilotOpenAutomation(): string | null {
  return useSyncExternalStore(subscribePilotAutomationsView, pilotOpenAutomation)
}

export function usePilotOpenJob(): string | null {
  return useSyncExternalStore(subscribePilotAutomationsView, pilotOpenJob)
}
