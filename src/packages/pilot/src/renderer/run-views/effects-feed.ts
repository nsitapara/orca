import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { Effect, RunEffects } from '../../shared/visibility-types'
import { hostRpc } from '../hosts/host-rpc'
import { hostedKey, LOCAL_PILOT_HOST, type PilotHostRef } from '../hosts/pilot-host'
import { usePilotHost } from '../hosts/PilotHostContext'

export const EFFECTS_REFRESH_MS = 10_000
export const EFFECTS_RETRY_MS = 5_000
export const MAX_CACHED_RUNS = 2000
const BATCH = 300

// Keyed hostedKey(host, runId): run ids are numbered per machine.
let cache: ReadonlyMap<string, readonly Effect[]> = new Map()
// The runs asked for this tick, by machine (host key).
const wanted = new Map<string, { host: PilotHostRef; ids: Set<string> }>()
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

// Asks one machine for one chunk; a failed read is tried once more after 5 s, and never holds back another machine's.
async function fetchChunk(host: PilotHostRef, ids: string[], canRetry = true): Promise<void> {
  try {
    const got = await hostRpc<RunEffects>(host, 'pilot.runs.effects', { runIds: ids })
    const next = new Map(cache)
    for (const id of ids) {
      const key = hostedKey(host, id)
      next.delete(key)
      next.set(key, listOf(got, id))
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
      setTimeout(() => void fetchChunk(host, ids, false), EFFECTS_RETRY_MS)
    }
  }
}

function flush(): void {
  scheduled = false
  const batches = [...wanted.values()]
  wanted.clear()
  for (const { host, ids } of batches) {
    const list = [...ids]
    for (let i = 0; i < list.length; i += BATCH) {
      void fetchChunk(host, list.slice(i, i + BATCH))
    }
  }
}

// Asks a machine (none: this one) for a run's effects; one pilot.runs.effects call per machine per tick.
export function requestEffects(runId: string, host: PilotHostRef = LOCAL_PILOT_HOST): void {
  const batch = wanted.get(host.key) ?? { host, ids: new Set<string>() }
  batch.ids.add(runId)
  wanted.set(host.key, batch)
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
  enabled = true,
  // The run's machine; none is the machine the surrounding view is for.
  host?: PilotHostRef
): readonly Effect[] | null {
  const viewHost = usePilotHost()
  const on = host ?? viewHost
  const key = hostedKey(on, runId)
  const effects = useSyncExternalStore(subscribe, () => cache.get(key) ?? null)
  const wasLive = useRef(live)
  useEffect(() => {
    if (enabled) {
      requestEffects(runId, on)
    }
  }, [runId, enabled, on])
  useEffect(() => {
    const ended = wasLive.current && !live
    wasLive.current = live
    if (enabled && ended) {
      requestEffects(runId, on)
    }
  }, [runId, live, enabled, on])
  useEffect(() => {
    if (!enabled || !live) {
      return undefined
    }
    const timer = setInterval(() => requestEffects(runId, on), EFFECTS_REFRESH_MS)
    return () => clearInterval(timer)
  }, [runId, live, enabled, on])
  return effects
}

// Tests only: forget every run's effects.
export function resetEffectsFeed(): void {
  cache = new Map()
  wanted.clear()
  scheduled = false
  notify()
}
