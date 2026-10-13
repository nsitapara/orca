import { useSyncExternalStore } from 'react'

// The sections switched OFF, by key; everything is on by default. Kept for this viewer in localStorage (every
// access guarded: it can be blocked or throw) and in memory, so a blocked store still works for the session.
const STORAGE_KEY = 'pilot.details.off'

let off: ReadonlySet<string> | null = null
const listeners = new Set<() => void>()

function read(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(
      Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
    )
  } catch {
    return new Set()
  }
}

function write(keys: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    // Private windows and blocked storage: the choice holds for this session only.
  }
}

function current(): ReadonlySet<string> {
  off ??= read()
  return off
}

function commit(next: Set<string>): void {
  off = next
  write(next)
  for (const listener of listeners) {
    listener()
  }
}

export function toggleSection(key: string): void {
  const next = new Set(current())
  if (!next.delete(key)) {
    next.add(key)
  }
  commit(next)
}

export function setAllSections(keys: string[], on: boolean): void {
  const next = new Set(current())
  for (const key of keys) {
    if (on) {
      next.delete(key)
    } else {
      next.add(key)
    }
  }
  commit(next)
}

// Forget the in-memory copy so the next read goes to storage again (tests, and a storage that changed).
export function resetSectionFilter(): void {
  off = null
  for (const listener of listeners) {
    listener()
  }
}

export function useOffSections(): ReadonlySet<string> {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, current)
}
