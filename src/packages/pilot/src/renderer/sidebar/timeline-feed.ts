import { useCallback, useSyncExternalStore } from 'react'
import type { WorktreeTimeline } from '../../shared/api-types'
import { pilotRpc } from '../api'
import { errorText } from '../pages/format'

export const TIMELINE_POLL_MS = 15_000

type Snapshot = { data: WorktreeTimeline | null; error: string | null }
type Feed = {
  snapshot: Snapshot
  listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
  onVisible: (() => void) | null
  loading: boolean
}

const EMPTY: Snapshot = { data: null, error: null }
// One poll per worktree, shared by everything that shows it (the panel and the activity-bar badge).
const feeds = new Map<string, Feed>()

function feedFor(path: string): Feed {
  let feed = feeds.get(path)
  if (!feed) {
    feed = { snapshot: EMPTY, listeners: new Set(), timer: null, onVisible: null, loading: false }
    feeds.set(path, feed)
  }
  return feed
}

async function load(path: string): Promise<void> {
  const feed = feeds.get(path)
  if (!feed || feed.loading) {
    return
  }
  feed.loading = true
  try {
    const data = await pilotRpc<WorktreeTimeline>('pilot.worktree.timeline', { worktreePath: path })
    feed.snapshot = { data, error: null }
  } catch (e) {
    // Keep showing the last timeline; say why it isn't fresh.
    feed.snapshot = { data: feed.snapshot.data, error: errorText(e) }
  } finally {
    feed.loading = false
  }
  feed.listeners.forEach((listener) => listener())
}

function stopFeed(feed: Feed): void {
  if (feed.timer) {
    clearInterval(feed.timer)
    feed.timer = null
  }
  if (feed.onVisible) {
    document.removeEventListener('visibilitychange', feed.onVisible)
    feed.onVisible = null
  }
}

function subscribe(path: string, listener: () => void): () => void {
  const feed = feedFor(path)
  feed.listeners.add(listener)
  if (!feed.timer) {
    void load(path)
    // A hidden window doesn't poll; it refreshes once when it shows again.
    feed.timer = setInterval(() => {
      if (!document.hidden) {
        void load(path)
      }
    }, TIMELINE_POLL_MS)
    feed.onVisible = () => {
      if (!document.hidden) {
        void load(path)
      }
    }
    document.addEventListener('visibilitychange', feed.onVisible)
  }
  return () => {
    feed.listeners.delete(listener)
    if (feed.listeners.size === 0 && feed.timer) {
      stopFeed(feed)
    }
  }
}

// After an action that changes the timeline (a Resume), so it shows at once rather than at the next poll.
export function refreshWorktreeTimeline(path: string): void {
  void load(path)
}

// Tests start every case from no feeds.
export function resetTimelineFeeds(): void {
  for (const feed of feeds.values()) {
    stopFeed(feed)
  }
  feeds.clear()
}

export function useWorktreeTimeline(path: string | null): Snapshot {
  const sub = useCallback(
    (listener: () => void) => (path ? subscribe(path, listener) : () => {}),
    [path]
  )
  const get = useCallback(() => (path ? (feeds.get(path)?.snapshot ?? EMPTY) : EMPTY), [path])
  return useSyncExternalStore(sub, get, () => EMPTY)
}
