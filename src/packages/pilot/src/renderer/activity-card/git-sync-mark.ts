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
  label: string
  action: GitSyncAction
}

export type WorktreeGitChipView = {
  sync: GitSyncMark | null
  // "3", or "1000+" past status's entry limit; null on a clean tree.
  changes: string | null
  label: string
}

function commits(count: number): string {
  return count === 1 ? '1 commit' : `${count} commits`
}

/**
 * The branch against origin. Yellow: commits here that origin doesn't have. Green: the same commits
 * as origin. Null on a detached HEAD, or an unpublished branch with no commits of its own.
 */
export function gitSyncMark(sync: WorktreeGitSync): GitSyncMark | null {
  if (!sync.onBranch) {
    return null
  }
  const { upstream } = sync
  if (!upstream.hasUpstream) {
    const count = sync.unpublishedCommits
    if (count === 0) {
      return null
    }
    // With no base to count from, publishing is offered but not asked for.
    return count === null
      ? {
          Icon: CloudUpload,
          tone: 'text-muted-foreground',
          count: null,
          label: 'Publish branch: not on origin yet',
          action: 'publish'
        }
      : {
          Icon: CloudUpload,
          tone: 'text-status-warning',
          count: String(count),
          label: `Publish branch: ${commits(count)} not on origin`,
          action: 'publish'
        }
  }
  const remote = upstream.upstreamName ?? 'origin'
  const { ahead, behind } = upstream
  if (ahead > 0 && behind > 0) {
    return {
      Icon: ArrowDownUp,
      tone: 'text-status-warning',
      count: `${ahead}↑ ${behind}↓`,
      label: `Diverged from ${remote}: ${commits(ahead)} to push, ${behind} to pull. Sync in Source Control`,
      action: 'open'
    }
  }
  if (ahead > 0) {
    return {
      Icon: ArrowUp,
      tone: 'text-status-warning',
      count: String(ahead),
      label: `Push ${commits(ahead)} to ${remote}`,
      action: 'push'
    }
  }
  if (behind > 0) {
    return {
      Icon: ArrowDown,
      tone: 'text-muted-foreground',
      count: String(behind),
      label: `${commits(behind)} to pull from ${remote}`,
      action: 'open'
    }
  }
  return {
    Icon: CloudCheck,
    tone: 'text-status-success',
    count: null,
    label: `In sync with ${remote}`,
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

/** What the chip shows: the branch against origin, then any uncommitted changes. Null when neither. */
export function worktreeGitChipView(sync: WorktreeGitSync | null): WorktreeGitChipView | null {
  if (!sync) {
    return null
  }
  const mark = gitSyncMark(sync)
  const changes = changesCount(sync)
  if (!mark && !changes) {
    return null
  }
  return {
    sync: mark,
    changes,
    label: [mark?.label, changes ? changesLabel(sync, changes) : null].filter(Boolean).join(' · ')
  }
}
