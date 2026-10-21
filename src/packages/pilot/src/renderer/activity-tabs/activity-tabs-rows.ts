import type { ActivityThreadGroup } from '@/components/activity/activity-thread-types'
import type { RecentWorktreeItem } from './recent-worktree-items'
import type { WorkspaceTabItem } from './workspace-tab-items'

/** One of Pilot's rows in a group, after its agents: an open tab, or a recently active worktree with no row yet. */
export type ActivityTabsRow =
  | { kind: 'tab'; tab: WorkspaceTabItem }
  | { kind: 'recent-worktree'; recent: RecentWorktreeItem }

/** A Pilot row in Activity's list. */
export type ActivityTabsVirtualItem = {
  type: 'workspace-tab'
  row: ActivityTabsRow
  groupKey: string
}

/** Grouped by worktree, the worktrees with no session, listed under one header after the rest. */
export const INACTIVE_WORKTREES_GROUP_KEY = 'pilot:inactive-worktrees'

const NO_ROWS: readonly ActivityTabsRow[] = []

// Why a WeakMap: Activity's group type stays upstream's; the rows ride on the group object.
const rowsByGroup = new WeakMap<ActivityThreadGroup, readonly ActivityTabsRow[]>()
// Groups whose rows are counted but not listed: Pilot owns their fold, not upstream's collapse set.
const foldedGroups = new WeakSet<ActivityThreadGroup>()
// Grouped by worktree, the child worktrees' groups listed under a group (activity-tabs-groups.ts).
const childGroupsByGroup = new WeakMap<ActivityThreadGroup, readonly ActivityThreadGroup[]>()
const NO_GROUPS: readonly ActivityThreadGroup[] = []

export function withGroupRows(
  group: ActivityThreadGroup,
  rows: readonly ActivityTabsRow[],
  folded = false
): ActivityThreadGroup {
  const next = { ...group }
  rowsByGroup.set(next, rows)
  if (folded) {
    foldedGroups.add(next)
  }
  return next
}

/** Every Pilot row a group carries, a worktree header's own row included. */
export function groupRows(group: ActivityThreadGroup): readonly ActivityTabsRow[] {
  return rowsByGroup.get(group) ?? NO_ROWS
}

export function isGroupFolded(group: ActivityThreadGroup): boolean {
  return foldedGroups.has(group)
}

/** A copy of the group that lists these child worktrees' groups under it, its Pilot rows and fold kept. */
export function withChildGroups(
  group: ActivityThreadGroup,
  children: readonly ActivityThreadGroup[]
): ActivityThreadGroup {
  const next = withGroupRows(group, groupRows(group), isGroupFolded(group))
  childGroupsByGroup.set(next, children)
  return next
}

export function childGroups(group: ActivityThreadGroup): readonly ActivityThreadGroup[] {
  return childGroupsByGroup.get(group) ?? NO_GROUPS
}

// A worktree group's header is a recent worktree's row (with its own New agent): no row under it.
function shownRows(group: ActivityThreadGroup): readonly ActivityTabsRow[] {
  if (isGroupFolded(group)) {
    return NO_ROWS
  }
  const rows = groupRows(group)
  return group.key.startsWith('worktree:') ? rows.filter((row) => row.kind === 'tab') : rows
}

// pilot-hook: activity-tabs-rows. Called per group by buildActivityVirtualItems.
export function activityTabsGroupRows(group: ActivityThreadGroup): ActivityTabsVirtualItem[] {
  return shownRows(group).map((row) => ({ type: 'workspace-tab', row, groupKey: group.key }))
}

// pilot-hook: activity-tabs-row-key.
export function activityTabsRowKey(item: ActivityTabsVirtualItem): string {
  return item.row.kind === 'tab' ? `w:${item.row.tab.key}` : `r:${item.row.recent.key}`
}

// pilot-hook: activity-tabs-header-count. A recent worktree's row is no tab, so it adds nothing.
export function activityTabsGroupCount(group: ActivityThreadGroup): number {
  return groupRows(group).filter((row) => row.kind === 'tab').length
}

// pilot-hook: activity-tabs-count. Keeps "No agent activity" away while Pilot rows are listed,
// a worktree header standing in for its row included.
export function withActivityTabsCount(
  threadCount: number,
  groups: readonly ActivityThreadGroup[]
): number {
  return groups.reduce((count, group) => count + groupRows(group).length, threadCount)
}
