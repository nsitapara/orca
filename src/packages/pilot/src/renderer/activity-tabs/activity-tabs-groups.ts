import type {
  ActivityGroupBy,
  ActivityThreadGroup
} from '@/components/activity/activity-thread-types'
import { translate } from '@/i18n/i18n'
import { withGroupRows, type ActivityTabsRow } from './activity-tabs-rows'

export const OPEN_TABS_GROUP_KEY = 'pilot:open-tabs'
export const RECENT_WORKTREES_GROUP_KEY = 'pilot:recent-worktrees'

// Mirrors getActivityThreadGroup, which takes an agent thread. A Pilot row has no status or agent
// type, so those groupings put it under Open tabs or Recently active.
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
    return { key: `worktree:${worktree.id}`, label: worktree.displayName }
  }
  return row.kind === 'tab'
    ? { key: OPEN_TABS_GROUP_KEY, label: 'Open tabs' }
    : { key: RECENT_WORKTREES_GROUP_KEY, label: 'Recently active' }
}

/** Puts each row in its Group by group, after the agents; groups with only Pilot rows go last. */
export function mergeRowsIntoGroups(
  groups: ActivityThreadGroup[],
  rows: readonly ActivityTabsRow[],
  groupBy: ActivityGroupBy
): ActivityThreadGroup[] {
  if (rows.length === 0) {
    return groups
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
  return merged
}
