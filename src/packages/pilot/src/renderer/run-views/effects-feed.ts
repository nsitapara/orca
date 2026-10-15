import { useEffect, useSyncExternalStore } from 'react'
import type { Effect, RunEffects } from '../../shared/visibility-types'
import { pilotRpc } from '../api'

export const EFFECTS_REFRESH_MS = 10_000
const BATCH = 300

let cache: ReadonlyMap<string, readonly Effect[]> = new Map()
const wanted = new Set<string>()
const listeners = new Set<() => void>()
let scheduled = false

function notify(): void {
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

function listOf(got: unknown, id: string): readonly Effect[] {
  const list = got && typeof got === 'object' ? (got as RunEffects)[id] : undefined
  return Array.isArray(list) ? list : []
}

async function fetchChunk(ids: string[]): Promise<void> {
  try {
    const got = await pilotRpc<RunEffects>('pilot.runs.effects', { runIds: ids })
    const next = new Map(cache)
    for (const id of ids) {
      next.set(id, listOf(got, id))
    }
    cache = next
    notify()
  } catch {
    // Left unknown: the row asks again when it remounts or, while live, on its next refresh.
  }
}

function flush(): void {
  scheduled = false
  const ids = [...wanted]
  wanted.clear()
  for (let i = 0; i < ids.length; i += BATCH) {
    void fetchChunk(ids.slice(i, i + BATCH))
  }
}

// Asks for a run's effects; every run asked for in the same tick goes in one pilot.runs.effects call.
export function requestEffects(runId: string): void {
  wanted.add(runId)
  if (!scheduled) {
    scheduled = true
    queueMicrotask(flush)
  }
}

// A run's effects (null until first loaded): asked for when the row mounts, and every 10 s while the run is live.
// `enabled` false: the caller already has them (Done for you), so nothing is asked.
export function useRunEffects(
  runId: string,
  live: boolean,
  enabled = true
): readonly Effect[] | null {
  const effects = useSyncExternalStore(subscribe, () => cache.get(runId) ?? null)
  useEffect(() => {
    if (!enabled) {
      return undefined
    }
    requestEffects(runId)
    if (!live) {
      return undefined
    }
    const timer = setInterval(() => requestEffects(runId), EFFECTS_REFRESH_MS)
    return () => clearInterval(timer)
  }, [runId, live, enabled])
  return effects
}

// Tests only: forget every run's effects.
export function resetEffectsFeed(): void {
  cache = new Map()
  wanted.clear()
  scheduled = false
  notify()
}
