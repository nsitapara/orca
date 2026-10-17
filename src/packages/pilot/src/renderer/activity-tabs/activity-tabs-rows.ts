import type { ActivityThreadGroup } from '@/components/activity/activity-thread-types'
import type { WorkspaceTabItem } from './workspace-tab-items'

/** A workspace tab's row in Activity's list, after its group's agents. */
export type ActivityTabsVirtualItem = {
  type: 'workspace-tab'
  tab: WorkspaceTabItem
  groupKey: string
}

const NO_TABS: readonly WorkspaceTabItem[] = []

// Why a WeakMap: Activity's group type stays upstream's; the tabs ride on the group object.
const tabsByGroup = new WeakMap<ActivityThreadGroup, readonly WorkspaceTabItem[]>()

export function withGroupTabs(
  group: ActivityThreadGroup,
  tabs: readonly WorkspaceTabItem[]
): ActivityThreadGroup {
  const next = { ...group }
  tabsByGroup.set(next, tabs)
  return next
}

function groupTabs(group: ActivityThreadGroup): readonly WorkspaceTabItem[] {
  return tabsByGroup.get(group) ?? NO_TABS
}

// pilot-hook: activity-tabs-rows. Called per group by buildActivityVirtualItems.
export function activityTabsGroupRows(group: ActivityThreadGroup): ActivityTabsVirtualItem[] {
  return groupTabs(group).map((tab) => ({ type: 'workspace-tab', tab, groupKey: group.key }))
}

// pilot-hook: activity-tabs-row-key.
export function activityTabsRowKey(item: ActivityTabsVirtualItem): string {
  return `w:${item.tab.key}`
}

// pilot-hook: activity-tabs-header-count.
export function activityTabsGroupCount(group: ActivityThreadGroup): number {
  return groupTabs(group).length
}

// pilot-hook: activity-tabs-count. Keeps "No agent activity" away while tabs are listed.
export function withActivityTabsCount(
  threadCount: number,
  groups: readonly ActivityThreadGroup[]
): number {
  return groups.reduce((count, group) => count + groupTabs(group).length, threadCount)
}
