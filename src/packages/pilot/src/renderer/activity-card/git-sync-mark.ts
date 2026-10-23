import {
  ArrowDown,
  ArrowDownUp,
  ArrowUp,
  CloudCheck,
  CloudUpload,
  type LucideIcon
} from 'lucide-react'
import type { WorktreeGitSync } from './worktree-git-sync-feed'

// `open`: Source Control, where pulls, syncs and commits happen.
export type GitSyncAction = 'push' | 'publish' | 'open'

export type GitSyncMark = {
  Icon: LucideIcon
  tone: string
  count: string | null
  // What is so; a chip that can't push says this.
  label: string
  // What a click does, for a push or publish.
  actionLabel: string | null
  action: GitSyncAction
}

export type WorktreeGitChipView = {
  sync: GitSyncMark | null
  // "3", or "1000+" past status's entry limit; null on a clean tree.
  changes: string | null
  label: string
  actionLabel: string | null
}

// The worktree's MR is merged: commits not on origin are what its merge left behind, not work to push.
export type GitSyncContext = { reviewMerged: boolean }

function commits(count: number): string {
  return count === 1 ? '1 commit' : `${count} commits`
}

// A branch not on origin: never pushed, or its origin branch deleted (as a merge's cleanup does).
function unpublishedMark(
  count: number | null,
  { reviewMerged }: GitSyncContext
): GitSyncMark | null {
  if (count === 0) {
    return null
  }
  if (reviewMerged) {
    return {
      Icon: CloudUpload,
      tone: 'text-muted-foreground',
      count: count === null ? null : String(count),
      label: `${count === null ? 'Branch' : commits(count)} not on origin · its MR is merged`,
      actionLabel: null,
      action: 'open'
    }
  }
  // With no base to count from, publishing is offered but not asked for.
  if (count === null) {
    return {
      Icon: CloudUpload,
      tone: 'text-muted-foreground',
      count: null,
      label: 'Branch not on origin yet',
      actionLabel: 'Publish branch: not on origin yet',
      action: 'publish'
    }
  }
  return {
    Icon: CloudUpload,
    tone: 'text-status-warning',
    count: String(count),
    label: `${commits(count)} not on origin`,
    actionLabel: `Publish branch: ${commits(count)} not on origin`,
    action: 'publish'
  }
}

/**
 * The branch against origin. Yellow: commits here that origin doesn't have. Green: the same commits
 * as origin. Null on a detached HEAD, or an unpublished branch with no commits of its own.
 */
export function gitSyncMark(sync: WorktreeGitSync, context: GitSyncContext): GitSyncMark | null {
  if (!sync.onBranch) {
    return null
  }
  const { upstream } = sync
  if (!upstream.hasUpstream) {
    return unpublishedMark(sync.unpublishedCommits, context)
  }
  const remote = upstream.upstreamName ?? 'origin'
  const { ahead, behind } = upstream
  if (ahead > 0 && behind > 0) {
    return {
      Icon: ArrowDownUp,
      tone: 'text-status-warning',
      count: `${ahead}↑ ${behind}↓`,
      label: `Diverged from ${remote}: ${commits(ahead)} to push, ${behind} to pull. Sync in Source Control`,
      actionLabel: null,
      action: 'open'
    }
  }
  if (ahead > 0) {
    return {
      Icon: ArrowUp,
      tone: 'text-status-warning',
      count: String(ahead),
      label: `${commits(ahead)} to push to ${remote}`,
      actionLabel: `Push ${commits(ahead)} to ${remote}`,
      action: 'push'
    }
  }
  if (behind > 0) {
    return {
      Icon: ArrowDown,
      tone: 'text-muted-foreground',
      count: String(behind),
      label: `${commits(behind)} to pull from ${remote}`,
      actionLabel: null,
      action: 'open'
    }
  }
  return {
    Icon: CloudCheck,
    tone: 'text-status-success',
    count: null,
    label: `In sync with ${remote}`,
    actionLabel: null,
    action: 'open'
  }
}

function changesCount(sync: WorktreeGitSync): string | null {
  if (sync.changes === 0) {
    return null
  }
  return sync.changesCapped ? `${sync.changes}+` : String(sync.changes)
}

function changesLabel(sync: WorktreeGitSync, count: string): string {
  return sync.changes === 1 && !sync.changesCapped
    ? '1 uncommitted change'
    : `${count} uncommitted changes`
}

function joinLabel(...parts: (string | null | undefined)[]): string {
  return parts.filter(Boolean).join(' · ')
}

/** What the chip shows: the branch against origin, then any uncommitted changes. Null when neither. */
export function worktreeGitChipView(
  sync: WorktreeGitSync | null,
  context: GitSyncContext
): WorktreeGitChipView | null {
  if (!sync) {
    return null
  }
  const mark = gitSyncMark(sync, context)
  const changes = changesCount(sync)
  if (!mark && !changes) {
    return null
  }
  const changesText = changes ? changesLabel(sync, changes) : null
  return {
    sync: mark,
    changes,
    label: joinLabel(mark?.label, changesText),
    actionLabel: mark?.actionLabel ? joinLabel(mark.actionLabel, changesText) : null
  }
}
