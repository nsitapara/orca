import { useSyncExternalStore } from 'react'
import type { Worktree } from '../../../../../shared/worktree/types'
import {
  isRemoteExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../../shared/execution-host'
import {
  isArtifactsPayload,
  type AgentArtifact,
  type ArtifactsPayload
} from '../../shared/api-types-artifacts'
import { pilotRpc } from '../api'
import { pilotStore } from '../store'
import {
  artifactsForWorktree,
  indexArtifactsByWorktree,
  type ArtifactsByWorktree
} from './artifacts-match'

// pilotcli rescans changed transcripts on each read, and each read is a telemetry line: once a minute while the
// window has focus, on focus, and on Refresh. Pilot's main process shares one read between callers.
export const ARTIFACTS_REFRESH_MS = 60_000
// While Pilot's read runs (the first scan of every transcript), ask again this soon for its answer.
const FOLLOW_UP_MS = 3_000
const RPC_TIMEOUT_MS = 30_000
export const UNREADABLE_ARTIFACTS_ANSWER = "Pilot answered in a shape this window doesn't read"

export type ArtifactsFeed = {
  artifacts: readonly AgentArtifact[]
  byWorktree: ArtifactsByWorktree
  fetchedAt: number | null
  // Why the list may be empty or stale: pilotcli missing or too old, a failed read, or Pilot unreachable.
  error: string | null
  loading: boolean
}

const EMPTY: ArtifactsFeed = {
  artifacts: [],
  byWorktree: new Map(),
  fetchedAt: null,
  error: null,
  loading: false
}

let feed: ArtifactsFeed = EMPTY
let inFlight = false
// A Refresh asked while a plain read is in flight runs once that read is back.
let refreshAfter = false
let followUp: ReturnType<typeof setTimeout> | null = null
let stopPolling: (() => void) | null = null
const listeners = new Set<() => void>()

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function publish(next: ArtifactsFeed): void {
  feed = next
  for (const listener of listeners) {
    listener()
  }
}

function take(answer: unknown): void {
  if (!isArtifactsPayload(answer)) {
    publish({ ...feed, error: UNREADABLE_ARTIFACTS_ANSWER, loading: false })
    return
  }
  const payload: ArtifactsPayload = answer
  const same = payload.fetchedAt !== null && payload.fetchedAt === feed.fetchedAt
  publish({
    artifacts: same ? feed.artifacts : payload.artifacts,
    byWorktree: same ? feed.byWorktree : indexArtifactsByWorktree(payload.artifacts),
    fetchedAt: payload.fetchedAt,
    error: payload.error,
    loading: payload.refreshing
  })
  if (payload.refreshing && listeners.size > 0) {
    followUp ??= setTimeout(() => {
      followUp = null
      loadArtifacts(false)
    }, FOLLOW_UP_MS)
  }
}

/** Asks Pilot for the index; `refresh` makes it read pilotcli again now. Inert until Pilot attaches. */
export function loadArtifacts(refresh: boolean): void {
  if (!pilotStore()) {
    return
  }
  if (inFlight) {
    refreshAfter ||= refresh
    return
  }
  inFlight = true
  if (!feed.loading) {
    publish({ ...feed, loading: true })
  }
  pilotRpc<unknown>('pilot.artifacts.list', refresh ? { refresh: true } : {}, {
    timeoutMs: RPC_TIMEOUT_MS
  })
    .then(take, (e: unknown) => publish({ ...feed, error: messageOf(e), loading: false }))
    .finally(() => {
      inFlight = false
      if (refreshAfter) {
        refreshAfter = false
        loadArtifacts(true)
      }
    })
}

function startPolling(): () => void {
  const onFocus = (): void => loadArtifacts(false)
  const onVisible = (): void => {
    if (!document.hidden) {
      loadArtifacts(false)
    }
  }
  // A window left showing on another screen doesn't read all day.
  const timer = setInterval(() => {
    if (document.hasFocus()) {
      loadArtifacts(false)
    }
  }, ARTIFACTS_REFRESH_MS)
  window.addEventListener('focus', onFocus)
  document.addEventListener('visibilitychange', onVisible)
  loadArtifacts(false)
  return () => {
    clearInterval(timer)
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisible)
    if (followUp) {
      clearTimeout(followUp)
      followUp = null
    }
  }
}

// Polls while anything shows the feed: the page, a chip or the fold-out.
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  stopPolling ??= startPolling()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && stopPolling) {
      stopPolling()
      stopPolling = null
    }
  }
}

function current(): ArtifactsFeed {
  return feed
}

export function useArtifactsFeed(): ArtifactsFeed {
  return useSyncExternalStore(subscribe, current, () => EMPTY)
}

// The index is this machine's, so only a worktree on this machine can match it: a remote one's path names a folder
// on another computer.
export function isThisMachinesWorktree(
  worktree: Pick<Worktree, 'hostId' | 'runtimeOwnerEnvironmentId'>
): boolean {
  const owner = worktree.runtimeOwnerEnvironmentId?.trim()
  return !isRemoteExecutionHostId(owner ? toRuntimeExecutionHostId(owner) : worktree.hostId)
}

/** The artifacts published from a worktree or folder workspace, newest first. */
export function useWorktreeArtifacts(
  worktree: Pick<Worktree, 'path' | 'hostId' | 'runtimeOwnerEnvironmentId'> | null | undefined
): readonly AgentArtifact[] {
  const { byWorktree } = useArtifactsFeed()
  const path = worktree && isThisMachinesWorktree(worktree) ? worktree.path : null
  return artifactsForWorktree(byWorktree, path)
}

// Tests only.
export function resetArtifactsFeed(): void {
  stopPolling?.()
  stopPolling = null
  listeners.clear()
  inFlight = false
  refreshAfter = false
  feed = EMPTY
}
