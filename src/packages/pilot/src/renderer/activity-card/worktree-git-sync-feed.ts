import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { GitStatusResult, GitUpstreamStatus } from '../../../../../shared/git-status-types'
import { isGitRepoKind } from '../../../../../shared/repo-kind'
import type { Repo } from '../../../../../shared/repo-types'
import { getWorktreeHostIdentity } from '../../../../../shared/worktree/host-qualified-identity'
import type { GitStatusMetadataChangedEvent, Worktree } from '../../../../../shared/worktree/types'
import { isGitStatusSignalForWorktree } from '@/components/right-sidebar/git-status-signal-attribution'
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
// A commit anywhere in a repo (and every SSH change) names no worktree. Fanning each one out to every
// visible worktree of the repo would re-read them all per commit, so it happens at most this often.
const UNATTRIBUTED_GAP_MS = 30_000
// Under the poll, so each poll reads a push-target worktree's upstream afresh.
const PUSH_TARGET_UPSTREAM_TTL_MS = 45_000
// Leaves the git admission's interactive headroom to Source Control.
const MAX_IN_FLIGHT = 2
// Compare outcomes that hold for the HEAD; an `error` is asked again on the next read.
const SETTLED_COMPARE = new Set(['ready', 'invalid-base', 'unborn-head', 'no-merge-base'])

export type WorktreeGitSync = {
  /** Files git status lists: modified, staged or untracked. */
  changes: number
  /** Status stopped at its entry limit, so `changes` is a floor. */
  changesCapped: boolean
  /** False on a detached HEAD, which has nothing to push. */
  onBranch: boolean
  upstream: GitUpstreamStatus
  /** A branch not on origin: its commits past the worktree's base, or null with no base to count from. */
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
  // A push-target worktree's upstream, for the HEAD it was read at. A push or fetch moves it without
  // moving HEAD, so those drop it.
  pushTargetUpstream: { key: string; upstream: GitUpstreamStatus; at: number } | null
  // Bumped on each drop, so a read begun before it can't put the old upstream back.
  upstreamGeneration: number
  // The push is done; the first read begun after it ends the spinner, so the old push isn't offered again.
  settlePush: boolean
  // The store's upstream for this worktree, which Source Control writes after its pushes and fetches.
  storeUpstream: GitUpstreamStatus | undefined
}

const EMPTY: WorktreeGitSnapshot = { sync: null, pushing: false }
// One read per worktree, shared by every chip that shows it (its header, its Inbox cards).
const feeds = new Map<string, Feed>()
const queue = new Set<string>()
const repoFanouts = new Map<
  string,
  { at: number; trailing: ReturnType<typeof setTimeout> | null }
>()
let inFlight = 0
let subscribers = 0
let detachSignals: (() => void) | null = null
// Tests reset the module between cases; a read from before a reset must not touch the new state.
let epoch = 0

function notify(feed: Feed): void {
  feed.listeners.forEach((listener) => listener())
}

function setSnapshot(feed: Feed, next: Partial<WorktreeGitSnapshot>): void {
  feed.snapshot = { ...feed.snapshot, ...next }
  notify(feed)
}

function dropUpstream(feed: Feed): void {
  feed.pushTargetUpstream = null
  feed.upstreamGeneration += 1
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
// Null when status failed, or a host too old to fold the upstream into it: keep the last answer.
async function upstreamFor(
  feed: Feed,
  context: RuntimeGitContext,
  { worktree }: Subject,
  status: GitStatusResult,
  generation: number
): Promise<GitUpstreamStatus | null> {
  const pushTarget = worktree.pushTarget
  if (!pushTarget) {
    return status.upstreamStatus ?? null
  }
  const key = JSON.stringify([
    status.head ?? null,
    status.branch ?? null,
    pushTarget.remoteName,
    pushTarget.branchName,
    pushTarget.remoteUrl ?? null
  ])
  const cached = feed.pushTargetUpstream
  if (cached?.key === key && Date.now() - cached.at < PUSH_TARGET_UPSTREAM_TTL_MS) {
    return cached.upstream
  }
  const upstream = await getRuntimeGitUpstreamStatus(context, pushTarget)
  if (feed.upstreamGeneration === generation) {
    feed.pushTargetUpstream = { key, upstream, at: Date.now() }
  }
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
  if (SETTLED_COMPARE.has(summary.status)) {
    feed.unpublished = { key, commits }
  }
  return commits
}

async function readSync(feed: Feed, signal: AbortSignal): Promise<WorktreeGitSync | null> {
  const subject = feed.subject
  const context = subject ? gitContextFor(subject) : null
  if (!subject || !context) {
    return null
  }
  const generation = feed.upstreamGeneration
  const status = await getRuntimeGitStatus(context, {
    admissionTier: 'background',
    includeLineStats: false,
    signal
  })
  const upstream = await upstreamFor(feed, context, subject, status, generation)
  if (!upstream) {
    return null
  }
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
  const runEpoch = epoch
  inFlight += 1
  feed.lastStartedAt = Date.now()
  const settles = feed.settlePush
  feed.settlePush = false
  const controller = new AbortController()
  feed.controller = controller
  const next: Partial<WorktreeGitSnapshot> = {}
  try {
    const sync = await readSync(feed, controller.signal)
    if (sync && !controller.signal.aborted) {
      next.sync = sync
    }
  } catch {
    // Keep the last answer; the next signal or poll asks again.
  } finally {
    if (runEpoch === epoch) {
      inFlight -= 1
      feed.controller = null
      if (settles) {
        next.pushing = false
      }
      if (Object.keys(next).length > 0) {
        setSnapshot(feed, next)
      }
      const again = feed.again
      feed.again = 'none'
      if (again !== 'none') {
        requestRefresh(key, again === 'now')
      }
      drain()
    }
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

// `now` skips the pacing and the hidden-window wait: after the chip's own push, the answer is the point.
function requestRefresh(key: string, now = false): void {
  const feed = feeds.get(key)
  if (!feed?.subject || feed.listeners.size === 0) {
    return
  }
  // A hidden window asks once when it shows again.
  if (!now && !isWindowVisible()) {
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

function refreshWhere(matches: (subject: Subject, feed: Feed) => boolean): void {
  for (const [key, feed] of feeds) {
    if (feed.listeners.size > 0 && feed.subject && matches(feed.subject, feed)) {
      requestRefresh(key)
    }
  }
}

function fanOutUnattributed(repoId: string): void {
  let fanout = repoFanouts.get(repoId)
  if (!fanout) {
    fanout = { at: 0, trailing: null }
    repoFanouts.set(repoId, fanout)
  }
  if (fanout.trailing) {
    return
  }
  const pending = fanout
  const fan = (): void => {
    pending.trailing = null
    pending.at = Date.now()
    refreshWhere(({ worktree }) => worktree.repoId === repoId)
  }
  const wait = pending.at + UNATTRIBUTED_GAP_MS - Date.now()
  if (wait > 0) {
    pending.trailing = setTimeout(fan, wait)
  } else {
    fan()
  }
}

function attachSignals(): () => void {
  const onMetadata = (signal: GitStatusMetadataChangedEvent): void => {
    if (!signal.worktreePaths?.length) {
      fanOutUnattributed(signal.repoId)
      return
    }
    const paths = (useAppStore.getState().worktreesByRepo[signal.repoId] ?? []).map((w) => w.path)
    refreshWhere(
      ({ worktree }) =>
        worktree.repoId === signal.repoId &&
        isGitStatusSignalForWorktree(signal, worktree.path, paths)
    )
  }
  // A finished command may have pushed or fetched, which moves a push-target upstream without HEAD.
  const onCommandFinished = (event: Event): void => {
    const worktreeId: unknown = event instanceof CustomEvent ? event.detail?.worktreeId : undefined
    refreshWhere(({ worktree }, feed) => {
      if (worktree.id !== worktreeId) {
        return false
      }
      dropUpstream(feed)
      return true
    })
  }
  // Source Control's pushes, pulls and fetches land in the store's upstream status.
  const unsubscribeStore = useAppStore.subscribe((state, previous) => {
    if (state.remoteStatusesByWorktree === previous.remoteStatusesByWorktree) {
      return
    }
    refreshWhere(({ worktree }, feed) => {
      const upstream = state.remoteStatusesByWorktree[worktree.id]
      if (upstream === feed.storeUpstream) {
        return false
      }
      feed.storeUpstream = upstream
      dropUpstream(feed)
      return true
    })
  })
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
    unsubscribeStore()
    unsubscribeMetadata?.()
    window.removeEventListener(ORCA_TERMINAL_COMMAND_FINISHED_EVENT, onCommandFinished)
    document.removeEventListener('visibilitychange', onVisible)
    for (const fanout of repoFanouts.values()) {
      if (fanout.trailing) {
        clearTimeout(fanout.trailing)
      }
    }
    repoFanouts.clear()
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
      unpublished: null,
      pushTargetUpstream: null,
      upstreamGeneration: 0,
      settlePush: false,
      storeUpstream: undefined
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
      if (feed.controller) {
        feed.controller.abort()
        // The aborted read answered nothing, so a remount (StrictMode's included) asks at once.
        feed.lastStartedAt = 0
      }
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
  if (!previous) {
    feed.storeUpstream = useAppStore.getState().remoteStatusesByWorktree[subject.worktree.id]
  }
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
 * Pushes the worktree's branch as Source Control's Push (or Publish Branch) does, through the same
 * host its state was read from, then reads it again. The store toasts a failure; the chip then shows
 * where the branch stands.
 */
export async function pushWorktreeBranch(worktree: Worktree, publish: boolean): Promise<void> {
  const key = getWorktreeHostIdentity(worktree)
  const feed = feeds.get(key)
  const context = feed?.subject ? gitContextFor(feed.subject) : null
  if (!feed || !context || feed.snapshot.pushing) {
    return
  }
  setSnapshot(feed, { pushing: true })
  try {
    await useAppStore
      .getState()
      .pushBranch(worktree.id, worktree.path, publish, context.connectionId, worktree.pushTarget, {
        runtimeTarget: context.target
      })
  } catch {
    // The store already toasted why.
  } finally {
    dropUpstream(feed)
    if (feed.listeners.size > 0) {
      feed.settlePush = true
      requestRefresh(key, true)
    } else {
      setSnapshot(feed, { pushing: false })
    }
  }
}

// Tests start every case from no feeds.
export function resetWorktreeGitSyncFeeds(): void {
  epoch += 1
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
 * kept fresh by git's change signals, finished terminal commands, Source Control's remote actions and
 * a slow poll. Nothing for a folder workspace.
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
