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

const NO_ROWS: readonly ActivityTabsRow[] = []

// Why a WeakMap: Activity's group type stays upstream's; the rows ride on the group object.
const rowsByGroup = new WeakMap<ActivityThreadGroup, readonly ActivityTabsRow[]>()

export function withGroupRows(
  group: ActivityThreadGroup,
  rows: readonly ActivityTabsRow[]
): ActivityThreadGroup {
  const next = { ...group }
  rowsByGroup.set(next, rows)
  return next
}

function groupRows(group: ActivityThreadGroup): readonly ActivityTabsRow[] {
  return rowsByGroup.get(group) ?? NO_ROWS
}

// A worktree group's header is a recent worktree's row (with its own New agent): no row under it.
function shownRows(group: ActivityThreadGroup): readonly ActivityTabsRow[] {
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
