import type {
  ActivityGroupBy,
  ActivityThreadGroup
} from '@/components/activity/activity-thread-types'
import { translate } from '@/i18n/i18n'
import { withGroupTabs } from './activity-tabs-rows'
import type { WorkspaceTabItem } from './workspace-tab-items'

export const OPEN_TABS_GROUP_KEY = 'pilot:open-tabs'

// Mirrors getActivityThreadGroup, which takes an agent thread. A tab has no status or agent type,
// so those groupings put it under Open tabs.
function tabGroup(tab: WorkspaceTabItem, groupBy: ActivityGroupBy): { key: string; label: string } {
  if (groupBy === 'none') {
    return { key: 'all', label: '' }
  }
  if (groupBy === 'project') {
    return tab.repo
      ? { key: `project:${tab.repo.id}`, label: tab.repo.displayName }
      : {
          key: 'project:unknown',
          label: translate(
            'auto.components.activity.ActivityPrototypePage.5651b216c6',
            'Unknown project'
          )
        }
  }
  if (groupBy === 'worktree') {
    return { key: `worktree:${tab.worktree.id}`, label: tab.worktree.displayName }
  }
  return { key: OPEN_TABS_GROUP_KEY, label: 'Open tabs' }
}

/** Puts each tab in its Group by group, after the agents; groups with only tabs go last. */
export function mergeTabsIntoGroups(
  groups: ActivityThreadGroup[],
  tabs: readonly WorkspaceTabItem[],
  groupBy: ActivityGroupBy
): ActivityThreadGroup[] {
  if (tabs.length === 0) {
    return groups
  }
  const pending = new Map<string, { label: string; tabs: WorkspaceTabItem[] }>()
  for (const tab of tabs) {
    const { key, label } = tabGroup(tab, groupBy)
    const entry = pending.get(key)
    if (entry) {
      entry.tabs.push(tab)
    } else {
      pending.set(key, { label, tabs: [tab] })
    }
  }
  const merged = groups.map((group) => {
    const entry = pending.get(group.key)
    if (!entry) {
      return group
    }
    pending.delete(group.key)
    return withGroupTabs(group, entry.tabs)
  })
  for (const [key, entry] of pending) {
    merged.push(withGroupTabs({ key, label: entry.label, threads: [] }, entry.tabs))
  }
  return merged
}
