import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { isActivitySearchQueryTooLarge } from '@/components/activity/activity-thread-grouping'
import { getPaletteWorktreeIdentity } from '@/lib/palette-repo-resolution'
import {
  compareWorktreeNames,
  matchesQuery,
  workspaceMatchesActivityScope,
  type WorktreeTabsContext
} from './workspace-tab-items'

export const RECENT_WORKTREE_WINDOW_MS = 3 * 24 * 60 * 60 * 1000

/** A pinned or recently active worktree Activity lists nothing for: a row to start a session from. */
export type RecentWorktreeItem = {
  key: string
  worktree: Worktree
  repo: Repo | null
  openTabCount: number
  pinned: boolean
}

export function worktreeRowKey(worktree: Worktree): string {
  return getPaletteWorktreeIdentity(worktree)
}

/**
 * Worktrees in Activity's scope with no row there yet: every pinned one, and with `includeRecent` those
 * active within the window. Pinned first, then by name, so opening one never moves it.
 */
export function buildRecentWorktreeItems(input: {
  worktrees: readonly Worktree[]
  includeRecent: boolean
  // worktreeRowKey of every worktree Activity already has a row for.
  listed: ReadonlySet<string>
  openTabCount(worktreeId: string): number
  now: number
  ctx: Pick<WorktreeTabsContext, 'resolveRepo' | 'scope' | 'query'>
}): RecentWorktreeItem[] {
  const { ctx } = input
  if (isActivitySearchQueryTooLarge(ctx.query)) {
    return []
  }
  const search = ctx.query.trim().toLowerCase()
  const items: RecentWorktreeItem[] = []
  for (const worktree of input.worktrees) {
    const key = worktreeRowKey(worktree)
    const recent =
      input.includeRecent && input.now - worktree.lastActivityAt <= RECENT_WORKTREE_WINDOW_MS
    if (
      worktree.id === FLOATING_TERMINAL_WORKTREE_ID ||
      worktree.isArchived ||
      !(worktree.isPinned || recent) ||
      input.listed.has(key)
    ) {
      continue
    }
    const repo = ctx.resolveRepo(worktree)
    if (!workspaceMatchesActivityScope({ worktree, repo }, ctx.scope)) {
      continue
    }
    if (!matchesQuery(search, [worktree.displayName, worktree.branch, repo?.displayName ?? ''])) {
      continue
    }
    const openTabCount = input.openTabCount(worktree.id)
    items.push({ key, worktree, repo, openTabCount, pinned: worktree.isPinned })
  }
  return items.sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      compareWorktreeNames(a.worktree.displayName, b.worktree.displayName)
  )
}
