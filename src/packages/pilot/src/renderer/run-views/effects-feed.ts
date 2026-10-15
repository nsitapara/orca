import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Effect, RunEffects } from '../../shared/visibility-types'
import { pilotRpc } from '../api'

export const EFFECTS_REFRESH_MS = 10_000
export const EFFECTS_RETRY_MS = 5_000
export const MAX_CACHED_RUNS = 2000
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
  return Array.isArray(list) ? list.filter(isEffect) : []
}

// A well-formed effect: an object with a string kind and a numeric count.
function isEffect(e: unknown): e is Effect {
  if (!e || typeof e !== 'object') {
    return false
  }
  const { kind, count } = e as { kind?: unknown; count?: unknown }
  return typeof kind === 'string' && typeof count === 'number'
}

// Asks for one chunk; a failed read is tried once more after 5 s.
async function fetchChunk(ids: string[], canRetry = true): Promise<void> {
  try {
    const got = await pilotRpc<RunEffects>('pilot.runs.effects', { runIds: ids })
    const next = new Map(cache)
    for (const id of ids) {
      next.delete(id)
      next.set(id, listOf(got, id))
    }
    for (const old of next.keys()) {
      if (next.size <= MAX_CACHED_RUNS) {
        break
      }
      next.delete(old)
    }
    cache = next
    notify()
  } catch {
    if (canRetry) {
      setTimeout(() => void fetchChunk(ids, false), EFFECTS_RETRY_MS)
    }
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

// A run's effects (null until first loaded): asked for when the row mounts, every 10 s while the run is live, and once
// more when it ends. `enabled` false: the caller already has them (Done for you), so nothing is asked.
export function useRunEffects(
  runId: string,
  live: boolean,
  enabled = true
): readonly Effect[] | null {
  const effects = useSyncExternalStore(subscribe, () => cache.get(runId) ?? null)
  const wasLive = useRef(live)
  useEffect(() => {
    if (enabled) {
      requestEffects(runId)
    }
  }, [runId, enabled])
  useEffect(() => {
    const ended = wasLive.current && !live
    wasLive.current = live
    if (enabled && ended) {
      requestEffects(runId)
    }
  }, [runId, live, enabled])
  useEffect(() => {
    if (!enabled || !live) {
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
