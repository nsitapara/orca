import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { GitStatusResult, GitUpstreamStatus } from '../../../../../shared/git-status-types'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import type { Repo } from '../../../../../shared/repo-types'
import { getWorktreeHostIdentity } from '../../../../../shared/worktree/host-qualified-identity'
import type { GitStatusMetadataChangedEvent, Worktree } from '../../../../../shared/worktree/types'
import { isGitStatusSignalForWorktree } from '@/components/right-sidebar/git-status-signal-attribution'
import {
  getCachedAutomaticPushTargetUpstreamStatus,
  invalidateAutomaticPushTargetUpstreamStatusCache,
  storeCachedAutomaticPushTargetUpstreamStatus
} from '@/components/right-sidebar/push-target-upstream-refresh-cache'
import { ORCA_TERMINAL_COMMAND_FINISHED_EVENT } from '@/hooks/terminal-command-finished-event'
import { getConnectionId } from '@/lib/connection-context'
import { runtimeTargetForWorkspaceOwner } from '@/lib/resolve-owner'
import { isWindowVisible } from '@/lib/window-visibility-interval'
import { ipcOrRuntimeTargetForHostId } from '@/runtime/runtime-client-target'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import { getRuntimeGitBranchCompare } from '@/runtime/runtime-git-diff-client'
import { getRuntimeGitStatus } from '@/runtime/runtime-git-status-client'
import { getRuntimeGitUpstreamStatus } from '@/runtime/runtime-git-sync-client'
import { useAppStore } from '@/store'
import { findRepoForHost } from '@/store/slices/repo-host-identity'

// Source Control's floor between two status reads of one checkout.
const MIN_GAP_MS = 3000
// Agents edit files without touching the index, which no watcher reports.
const SAFETY_POLL_MS = 60_000
// Leaves the git admission's interactive headroom to Source Control.
const MAX_IN_FLIGHT = 2

export type WorktreeGitSync = {
  /** Files git status lists: modified, staged or untracked. */
  changes: number
  /** Status stopped at its entry limit, so `changes` is a floor. */
  changesCapped: boolean
  /** False on a detached HEAD, which has nothing to push. */
  onBranch: boolean
  upstream: GitUpstreamStatus
  /** A branch not on origin yet: its commits past the worktree's base, or null with no base to count from. */
  unpublishedCommits: number | null
}

export type WorktreeGitSnapshot = { sync: WorktreeGitSync | null; pushing: boolean }

type Subject = { worktree: Worktree; repo: Repo }
type Feed = {
  // Set by the hook's first effect; a subscription before it waits for it.
  subject: Subject | null
  snapshot: WorktreeGitSnapshot
  listeners: Set<() => void>
  controller: AbortController | null
  lastStartedAt: number
  trailing: ReturnType<typeof setTimeout> | null
  again: 'none' | 'paced' | 'now'
  // The last count of an unpublished branch's commits, for the HEAD and base it was counted at.
  unpublished: { key: string; commits: number | null } | null
}

const EMPTY: WorktreeGitSnapshot = { sync: null, pushing: false }
// One read per worktree, shared by every chip that shows it (its header, its Inbox cards).
const feeds = new Map<string, Feed>()
const queue = new Set<string>()
let inFlight = 0
let subscribers = 0
let detachSignals: (() => void) | null = null

function notify(feed: Feed): void {
  feed.listeners.forEach((listener) => listener())
}

function setSnapshot(feed: Feed, next: Partial<WorktreeGitSnapshot>): void {
  feed.snapshot = { ...feed.snapshot, ...next }
  notify(feed)
}

// The transport the Delete dialog's status reads use: another machine's worktree through its host.
function gitContextFor({ worktree }: Subject): RuntimeGitContext | null {
  const state = useAppStore.getState()
  if (worktree.hostId) {
    const target = ipcOrRuntimeTargetForHostId(worktree.hostId)
    const owner = findRepoForHost(state.repos, worktree.repoId, { hostId: worktree.hostId })
    return target
      ? {
          target,
          worktreeId: worktree.id,
          worktreePath: worktree.path,
          connectionId: owner?.connectionId ?? undefined
        }
      : null
  }
  const target = runtimeTargetForWorkspaceOwner(state, { workspaceId: worktree.id })
  const connectionId = getConnectionId(worktree.id) ?? undefined
  if (!target) {
    return null
  }
  if (connectionId && state.sshConnectionStates.get(connectionId)?.status !== 'connected') {
    return null
  }
  return { target, worktreeId: worktree.id, worktreePath: worktree.path, connectionId }
}

// Porcelain status compares with git's upstream; a PR-created worktree publishes to Orca's own target.
async function upstreamFor(
  context: RuntimeGitContext,
  { worktree }: Subject,
  status: GitStatusResult
): Promise<GitUpstreamStatus> {
  const pushTarget = worktree.pushTarget
  if (!pushTarget) {
    return status.upstreamStatus ?? getRuntimeGitUpstreamStatus(context)
  }
  const cacheInput = { ...context, worktreeId: worktree.id, pushTarget, status }
  const cached = getCachedAutomaticPushTargetUpstreamStatus(cacheInput)
  if (cached) {
    return cached
  }
  const upstream = await getRuntimeGitUpstreamStatus(context, pushTarget)
  storeCachedAutomaticPushTargetUpstreamStatus(cacheInput, upstream)
  return upstream
}

// Counted once per HEAD and base: a branch compare lists files too, so it isn't run on every poll.
async function unpublishedCommits(
  feed: Feed,
  { worktree, repo }: Subject,
  context: RuntimeGitContext,
  status: GitStatusResult
): Promise<number | null> {
  const baseRef = worktree.baseRef?.trim() || repo.worktreeBaseRef?.trim()
  if (!baseRef || !status.head) {
    return null
  }
  const key = `${status.head}\0${baseRef}`
  if (feed.unpublished?.key === key) {
    return feed.unpublished.commits
  }
  const { summary } = await getRuntimeGitBranchCompare(context, baseRef, 'background')
  const commits = summary.status === 'ready' ? (summary.commitsAhead ?? null) : null
  feed.unpublished = { key, commits }
  return commits
}

async function readSync(feed: Feed, signal: AbortSignal): Promise<WorktreeGitSync | null> {
  const subject = feed.subject
  const context = subject ? gitContextFor(subject) : null
  if (!subject || !context) {
    return null
  }
  const status = await getRuntimeGitStatus(context, {
    admissionTier: 'background',
    includeLineStats: false,
    signal
  })
  const upstream = await upstreamFor(context, subject, status)
  const onBranch = Boolean(status.branch)
  return {
    changes: status.entries.length,
    changesCapped: status.didHitLimit === true,
    onBranch,
    upstream,
    unpublishedCommits:
      onBranch && !upstream.hasUpstream
        ? await unpublishedCommits(feed, subject, context, status)
        : null
  }
}

async function run(key: string, feed: Feed): Promise<void> {
  inFlight += 1
  feed.lastStartedAt = Date.now()
  const controller = new AbortController()
  feed.controller = controller
  try {
    const sync = await readSync(feed, controller.signal)
    if (sync && !controller.signal.aborted) {
      setSnapshot(feed, { sync })
    }
  } catch {
    // Keep the last answer; the next signal or poll asks again.
  } finally {
    inFlight -= 1
    feed.controller = null
    const again = feed.again
    feed.again = 'none'
    if (again !== 'none') {
      requestRefresh(key, again === 'now')
    }
    drain()
  }
}

function drain(): void {
  for (const key of queue) {
    if (inFlight >= MAX_IN_FLIGHT) {
      return
    }
    queue.delete(key)
    const feed = feeds.get(key)
    if (feed && feed.listeners.size > 0 && !feed.controller) {
      void run(key, feed)
    }
  }
}

// `now` skips the pacing: after the chip's own push, the answer is the point.
function requestRefresh(key: string, now = false): void {
  const feed = feeds.get(key)
  if (!feed?.subject || feed.listeners.size === 0) {
    return
  }
  if (feed.controller) {
    feed.again = now || feed.again === 'now' ? 'now' : 'paced'
    return
  }
  const wait = now ? 0 : feed.lastStartedAt + MIN_GAP_MS - Date.now()
  if (wait > 0) {
    feed.trailing ??= setTimeout(() => {
      feed.trailing = null
      queue.add(key)
      drain()
    }, wait)
    return
  }
  if (feed.trailing) {
    clearTimeout(feed.trailing)
    feed.trailing = null
  }
  queue.add(key)
  drain()
}

function refreshWhere(matches: (subject: Subject) => boolean): void {
  for (const [key, feed] of feeds) {
    if (feed.listeners.size > 0 && feed.subject && matches(feed.subject)) {
      requestRefresh(key)
    }
  }
}

function attachSignals(): () => void {
  const onMetadata = (signal: GitStatusMetadataChangedEvent): void => {
    const paths = (useAppStore.getState().worktreesByRepo[signal.repoId] ?? []).map((w) => w.path)
    refreshWhere(
      ({ worktree }) =>
        worktree.repoId === signal.repoId &&
        isGitStatusSignalForWorktree(signal, worktree.path, paths)
    )
  }
  const onCommandFinished = (event: Event): void => {
    const worktreeId: unknown = event instanceof CustomEvent ? event.detail?.worktreeId : undefined
    refreshWhere(({ worktree }) => worktree.id === worktreeId)
  }
  // A hidden window doesn't poll; it asks once when it shows again.
  const onVisible = (): void => {
    if (isWindowVisible()) {
      refreshWhere(() => true)
    }
  }
  const timer = setInterval(onVisible, SAFETY_POLL_MS)
  // Remote web surfaces have no preload bridge; the poll still covers them.
  const unsubscribeMetadata = window.api?.worktrees?.onGitStatusMetadataChanged?.(onMetadata)
  window.addEventListener(ORCA_TERMINAL_COMMAND_FINISHED_EVENT, onCommandFinished)
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    clearInterval(timer)
    unsubscribeMetadata?.()
    window.removeEventListener(ORCA_TERMINAL_COMMAND_FINISHED_EVENT, onCommandFinished)
    document.removeEventListener('visibilitychange', onVisible)
  }
}

function feedFor(key: string): Feed {
  let feed = feeds.get(key)
  if (!feed) {
    feed = {
      subject: null,
      snapshot: EMPTY,
      listeners: new Set(),
      controller: null,
      lastStartedAt: 0,
      trailing: null,
      again: 'none',
      unpublished: null
    }
    feeds.set(key, feed)
  }
  return feed
}

function subscribe(key: string, listener: () => void): () => void {
  const feed = feedFor(key)
  feed.listeners.add(listener)
  subscribers += 1
  detachSignals ??= attachSignals()
  requestRefresh(key)
  return () => {
    feed.listeners.delete(listener)
    if (feed.listeners.size === 0) {
      // Keep the snapshot: a row scrolled back into view shows its last answer while it asks again.
      feed.controller?.abort()
      if (feed.trailing) {
        clearTimeout(feed.trailing)
        feed.trailing = null
      }
      queue.delete(key)
    }
    subscribers -= 1
    if (subscribers === 0) {
      detachSignals?.()
      detachSignals = null
    }
  }
}

// A new commit, branch or push target in the store means the last answer is out of date.
function noteSubject(key: string, subject: Subject): void {
  const feed = feedFor(key)
  const previous = feed.subject?.worktree
  feed.subject = subject
  if (
    !previous ||
    previous.head !== subject.worktree.head ||
    previous.branch !== subject.worktree.branch ||
    previous.path !== subject.worktree.path ||
    previous.pushTarget !== subject.worktree.pushTarget
  ) {
    requestRefresh(key)
  }
}

/**
 * Pushes the worktree's branch as Source Control's Push (or Publish Branch) does, then reads its
 * state again. The store toasts a failure; the chip shows where the branch stands after it.
 */
export async function pushWorktreeBranch(worktree: Worktree, publish: boolean): Promise<void> {
  const key = getWorktreeHostIdentity(worktree)
  const feed = feeds.get(key)
  if (!feed?.subject || feed.snapshot.pushing) {
    return
  }
  const subject = feed.subject
  setSnapshot(feed, { pushing: true })
  const connectionId = getConnectionId(worktree.id) ?? undefined
  try {
    await useAppStore
      .getState()
      .pushBranch(worktree.id, worktree.path, publish, connectionId, worktree.pushTarget)
  } catch {
    // The store already toasted why.
  } finally {
    const context = gitContextFor(subject)
    if (context && worktree.pushTarget) {
      // Why: the cache is keyed by HEAD, which a push leaves alone, so it would replay the old counts.
      invalidateAutomaticPushTargetUpstreamStatusCache({
        ...context,
        worktreeId: worktree.id,
        pushTarget: worktree.pushTarget
      })
    }
    setSnapshot(feed, { pushing: false })
    requestRefresh(key, true)
  }
}

// Tests start every case from no feeds.
export function resetWorktreeGitSyncFeeds(): void {
  for (const feed of feeds.values()) {
    feed.controller?.abort()
    if (feed.trailing) {
      clearTimeout(feed.trailing)
    }
  }
  feeds.clear()
  queue.clear()
  inFlight = 0
  subscribers = 0
  detachSignals?.()
  detachSignals = null
}

/**
 * The worktree's git state against origin and its uncommitted changes, read in the background and
 * kept fresh by git's change signals, finished terminal commands and a slow poll. Nothing for a
 * folder workspace.
 */
export function useWorktreeGitSync(worktree: Worktree, repo: Repo | null): WorktreeGitSnapshot {
  const gitRepo = repo && isGitRepoKind(repo) ? repo : null
  const key = gitRepo ? getWorktreeHostIdentity(worktree) : null
  useEffect(() => {
    if (key && gitRepo) {
      noteSubject(key, { worktree, repo: gitRepo })
    }
  }, [key, gitRepo, worktree])
  // Why by key: the subscription follows the worktree's identity, not each new store object.
  const sub = useCallback(
    (listener: () => void) => (key ? subscribe(key, listener) : () => {}),
    [key]
  )
  const get = useCallback(() => (key ? (feeds.get(key)?.snapshot ?? EMPTY) : EMPTY), [key])
  return useSyncExternalStore(sub, get, () => EMPTY)
}
