import { useSyncExternalStore } from 'react'
import type { AutomationListPayload, AutomationSummary } from '../../shared/api-types'
import { pilotRpc } from '../api'

export const AUTOMATIONS_POLL_MS = 20_000

export type AutomationsSnapshot = {
  list: AutomationSummary[]
  byId: Map<string, AutomationSummary>
}

const EMPTY: AutomationsSnapshot = { list: [], byId: new Map() }
let snapshot = EMPTY
const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null
let loading = false

async function load(): Promise<void> {
  if (loading) {
    return
  }
  loading = true
  try {
    const p = await pilotRpc<AutomationListPayload>('pilot.automations.list')
    snapshot = { list: p.automations, byId: new Map(p.automations.map((a) => [a.id, a])) }
  } catch {
    // Keep the last list: strips go on showing the chains they had.
  } finally {
    loading = false
  }
  listeners.forEach((listener) => listener())
}

// One poll shared by everything that draws a strip outside the list (Activity, the Inbox, the worktree panel). A hidden
// window doesn't poll.
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!timer) {
    void load()
    timer = setInterval(() => {
      if (!document.hidden) {
        void load()
      }
    }, AUTOMATIONS_POLL_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

export function useAutomationsFeed(): AutomationsSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY
  )
}

// Tests start every case from no feed.
export function resetAutomationsFeed(): void {
  if (timer) {
    clearInterval(timer)
  }
  timer = null
  snapshot = EMPTY
  listeners.clear()
}
