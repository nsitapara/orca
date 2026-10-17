import { useSyncExternalStore } from 'react'

// Which sub-view the Automations page shows. The sidebar's "Inbox", "Running" and "Playground" items flip it.
export type PilotAutomationsView = 'automations' | 'inbox' | 'activity' | 'running' | 'playground'

let current: PilotAutomationsView = 'automations'
let openId: string | null = null
// A job of several automations, by its job.id. A stage opened from the job's page keeps it set underneath.
let openJobId: string | null = null
// The tab an automation's page shows; a newly opened automation starts on How it runs.
export type AutomationTab = 'how' | 'activity' | 'yaml'
let tab: AutomationTab = 'how'
// A card the Inbox picks once its list has loaded (the run panel's "asks you" link).
let pendingCard: string | null = null
// The automations Activity opens filtered to (a list chip with several live runs).
let pendingFilter: string[] | null = null
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
  tab = 'how'
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

export function pilotAutomationTab(): AutomationTab {
  return tab
}

export function setPilotAutomationTab(next: AutomationTab): void {
  if (next === tab) {
    return
  }
  tab = next
  notify()
}

export function usePilotAutomationTab(): AutomationTab {
  return useSyncExternalStore(subscribePilotAutomationsView, pilotAutomationTab)
}

// An automation's page on one tab, from anywhere: a strip's chip, the run panel's links.
export function showPilotAutomation(id: string, on: AutomationTab): void {
  current = 'automations'
  openJobId = null
  openId = id
  tab = on
  notify()
}

// The Automations list, from any view (the run panel's first crumb).
export function showAutomationsPage(): void {
  current = 'automations'
  openId = null
  openJobId = null
  notify()
}

export function showInboxCard(id: string): void {
  current = 'inbox'
  openId = null
  openJobId = null
  pendingCard = id
  notify()
}

export function pendingInboxCard(): string | null {
  return pendingCard
}

export function clearPendingInboxCard(): void {
  if (pendingCard === null) {
    return
  }
  pendingCard = null
  notify()
}

export function pendingActivityFilter(): string[] | null {
  return pendingFilter
}

// Hooks for a page that is already mounted when showInboxCard / showActivity fire: notify() re-renders them.
export function usePendingInboxCard(): string | null {
  return useSyncExternalStore(subscribePilotAutomationsView, pendingInboxCard)
}

export function usePendingActivityFilter(): string[] | null {
  return useSyncExternalStore(subscribePilotAutomationsView, pendingActivityFilter)
}

export function showActivity(ids: string[] | null): void {
  current = 'activity'
  openId = null
  openJobId = null
  pendingFilter = ids
  notify()
}

export function takeActivityFilter(): string[] | null {
  const ids = pendingFilter
  if (ids !== null) {
    pendingFilter = null
    notify()
  }
  return ids
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
