import { useSyncExternalStore } from 'react'
import type { AutomationListPayload } from '../../shared/api-types'
import { createHostPoller, type HostPoller, type HostRead } from '../hosts/host-poll'
import {
  AUTOMATIONS_LIST,
  mergeAutomationLists,
  type MergedAutomation
} from '../hosts/merge-automations'

export const AUTOMATIONS_POLL_MS = 20_000

export type AutomationsSnapshot = {
  list: MergedAutomation[]
  byId: Map<string, MergedAutomation>
}

type ListRead = HostRead<AutomationListPayload>

const EMPTY: AutomationsSnapshot = { list: [], byId: new Map() }
let snapshot = EMPTY
// Each polled machine's last answered list: a failed read, or a poll restarted for a new reader, keeps it.
let kept: readonly ListRead[] = []
const listeners = new Set<() => void>()
let poller: HostPoller<AutomationListPayload> | null = null

function sameLists(a: readonly ListRead[], b: readonly ListRead[]): boolean {
  return a.length === b.length && a.every((r, i) => r.value === b[i].value && r.host === b[i].host)
}

// Only polled machines count, so one that can't be reached drops out and never shows as current.
function update(reads: readonly ListRead[]): void {
  const next = reads.flatMap((r) => {
    if (r.value !== null) {
      return [r]
    }
    const last = kept.find((k) => k.host.key === r.host.key)
    return last ? [{ ...last, host: r.host }] : []
  })
  const same = sameLists(next, kept)
  kept = next
  if (same) {
    return
  }
  const merged = mergeAutomationLists(next)
  snapshot = merged
    ? { list: merged.automations, byId: new Map(merged.automations.map((a) => [a.id, a])) }
    : EMPTY
  listeners.forEach((listener) => listener())
}

// One poll shared by everything that draws a strip outside the list (Activity, the Inbox, the worktree panel). A hidden
// window doesn't poll.
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!poller) {
    const p: HostPoller<AutomationListPayload> = createHostPoller<AutomationListPayload>({
      method: AUTOMATIONS_LIST,
      intervalMs: AUTOMATIONS_POLL_MS,
      skipHidden: true,
      onChange: () => update(p.reads())
    })
    poller = p
    void p.refresh()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && poller) {
      poller.stop()
      poller = null
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
  poller?.stop()
  poller = null
  snapshot = EMPTY
  kept = []
  listeners.clear()
}
