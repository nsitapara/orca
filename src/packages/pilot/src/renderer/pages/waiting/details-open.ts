import { useCallback, useSyncExternalStore } from 'react'

// Cards whose Details panel is open, so a card remounting as a new version stays open, and Expand all /
// Collapse all can set every card at once.
const OPEN = new Set<string>()
const listeners = new Set<() => void>()
// Bumped on every change: the snapshot the "all open" selector reads.
let version = 0

function notify(): void {
  version += 1
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setDetailsOpen(id: string, open: boolean): void {
  if (OPEN.has(id) === open) {
    return
  }
  if (open) {
    OPEN.add(id)
  } else {
    OPEN.delete(id)
  }
  notify()
}

export function setAllDetailsOpen(ids: string[], open: boolean): void {
  let changed = false
  for (const id of ids) {
    if (OPEN.has(id) !== open) {
      changed = true
      if (open) {
        OPEN.add(id)
      } else {
        OPEN.delete(id)
      }
    }
  }
  if (changed) {
    notify()
  }
}

export function useDetailsOpen(id: string): boolean {
  return useSyncExternalStore(subscribe, () => OPEN.has(id))
}

// True when every one of these cards has its Details open (and there is at least one).
export function useAllDetailsOpen(ids: string[]): boolean {
  const read = useCallback(() => {
    void version
    return ids.length > 0 && ids.every((id) => OPEN.has(id))
  }, [ids])
  return useSyncExternalStore(subscribe, read)
}
