import type {
  ActivityGroupBy,
  ActivityThreadGroup
} from '@/components/activity/activity-thread-types'
import { translate } from '@/i18n/i18n'
import {
  groupRows,
  INACTIVE_WORKTREES_GROUP_KEY,
  withGroupRows,
  type ActivityTabsRow
} from './activity-tabs-rows'
import { compareWorktreeNames } from './workspace-tab-items'

export const OPEN_TABS_GROUP_KEY = 'pilot:open-tabs'
export const RECENT_WORKTREES_GROUP_KEY = 'pilot:recent-worktrees'
export const PINNED_WORKTREES_GROUP_KEY = 'pilot:pinned-worktrees'
const WORKTREE_GROUP = 'worktree:'

// Mirrors getActivityThreadGroup, which takes an agent thread. A Pilot row has no status or agent
// type, so those groupings put it under Open tabs, Pinned or Recently active.
function rowGroup(row: ActivityTabsRow, groupBy: ActivityGroupBy): { key: string; label: string } {
  const { worktree, repo } = row.kind === 'tab' ? row.tab : row.recent
  if (groupBy === 'none') {
    return { key: 'all', label: '' }
  }
  if (groupBy === 'project') {
    return repo
      ? { key: `project:${repo.id}`, label: repo.displayName }
      : {
          key: 'project:unknown',
          label: translate(
            'auto.components.activity.ActivityPrototypePage.5651b216c6',
            'Unknown project'
          )
        }
  }
  if (groupBy === 'worktree') {
    return { key: `${WORKTREE_GROUP}${worktree.id}`, label: worktree.displayName }
  }
  if (row.kind === 'tab') {
    return { key: OPEN_TABS_GROUP_KEY, label: 'Open tabs' }
  }
  return row.recent.pinned
    ? { key: PINNED_WORKTREES_GROUP_KEY, label: 'Pinned' }
    : { key: RECENT_WORKTREES_GROUP_KEY, label: 'Recently active' }
}

// Grouped by worktree, a group's place depends only on its pin and its name: pinned first, then by
// name. Upstream orders agents' groups by their latest activity, and selecting a worktree must never
// move it.
function worktreeOrder(
  groups: ActivityThreadGroup[],
  groupBy: ActivityGroupBy,
  pinnedWorktreeIds: readonly string[]
): ActivityThreadGroup[] {
  if (groupBy !== 'worktree') {
    return groups
  }
  const pinned = new Set(pinnedWorktreeIds.map((id) => `${WORKTREE_GROUP}${id}`))
  return [...groups].sort(
    (a, b) =>
      Number(pinned.has(b.key)) - Number(pinned.has(a.key)) ||
      compareWorktreeNames(a.label, b.label)
  )
}

export type MergeRowsOptions = {
  pinnedWorktreeIds?: readonly string[]
  // The Inactive section's fold; it starts folded.
  inactiveExpanded?: boolean
}

// A worktree group whose only row is its own header's: the worktree has no agent and no tab.
function isInactiveWorktreeGroup(group: ActivityThreadGroup): boolean {
  const rows = groupRows(group)
  return (
    group.key.startsWith(WORKTREE_GROUP) &&
    group.threads.length === 0 &&
    rows.length > 0 &&
    rows.every((row) => row.kind === 'recent-worktree')
  )
}

// Grouped by worktree, worktrees with no session move, in order, under one Inactive header at the end.
function inactiveLast(
  groups: ActivityThreadGroup[],
  groupBy: ActivityGroupBy,
  inactiveExpanded: boolean
): ActivityThreadGroup[] {
  if (groupBy !== 'worktree') {
    return groups
  }
  const inactive = groups.filter(isInactiveWorktreeGroup)
  if (inactive.length === 0) {
    return groups
  }
  const section = withGroupRows(
    { key: INACTIVE_WORKTREES_GROUP_KEY, label: 'Inactive', threads: [] },
    inactive.flatMap(groupRows),
    !inactiveExpanded
  )
  return [...groups.filter((group) => !isInactiveWorktreeGroup(group)), section]
}

/**
 * Puts each row in its Group by group, after the agents; groups with only Pilot rows go after the
 * rest. Grouped by worktree, groups go pinned first, then by name, and those with no session go
 * under Inactive at the end.
 */
export function mergeRowsIntoGroups(
  groups: ActivityThreadGroup[],
  rows: readonly ActivityTabsRow[],
  groupBy: ActivityGroupBy,
  { pinnedWorktreeIds = [], inactiveExpanded = false }: MergeRowsOptions = {}
): ActivityThreadGroup[] {
  if (rows.length === 0) {
    return worktreeOrder(groups, groupBy, pinnedWorktreeIds)
  }
  const pending = new Map<string, { label: string; rows: ActivityTabsRow[] }>()
  for (const row of rows) {
    const { key, label } = rowGroup(row, groupBy)
    const entry = pending.get(key)
    if (entry) {
      entry.rows.push(row)
    } else {
      pending.set(key, { label, rows: [row] })
    }
  }
  const merged = groups.map((group) => {
    const entry = pending.get(group.key)
    if (!entry) {
      return group
    }
    pending.delete(group.key)
    return withGroupRows(group, entry.rows)
  })
  for (const [key, entry] of pending) {
    merged.push(withGroupRows({ key, label: entry.label, threads: [] }, entry.rows))
  }
  return inactiveLast(worktreeOrder(merged, groupBy, pinnedWorktreeIds), groupBy, inactiveExpanded)
}
