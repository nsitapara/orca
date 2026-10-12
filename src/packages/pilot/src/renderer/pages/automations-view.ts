import { useSyncExternalStore } from 'react'

// Which sub-view the Automations page shows. The sidebar's "Inbox" item flips it.
export type PilotAutomationsView = 'automations' | 'inbox'

let current: PilotAutomationsView = 'automations'
let openId: string | null = null
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
