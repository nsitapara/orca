import { useSyncExternalStore } from 'react'

// Which sub-view the Automations page shows. The sidebar's "Waiting on you" item flips it.
export type PilotAutomationsView = 'automations' | 'waiting'

let current: PilotAutomationsView = 'automations'
const listeners = new Set<() => void>()

export function pilotAutomationsView(): PilotAutomationsView {
  return current
}

export function setPilotAutomationsView(next: PilotAutomationsView): void {
  if (next === current) {
    return
  }
  current = next
  for (const listener of listeners) {
    listener()
  }
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
