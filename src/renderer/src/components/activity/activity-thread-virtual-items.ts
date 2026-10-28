import type { ActivityGroupBy, ActivityThreadGroup, AgentPaneThread } from './activity-thread-types'
import {
  activityTabsGroupRows,
  activityTabsRowKey,
  type ActivityTabsVirtualItem
} from '../../../../packages/pilot/src/renderer/activity-tabs/activity-tabs-rows' // pilot-hook: activity-tabs-rows
import { activityTabsItemEstimate } from '../../../../packages/pilot/src/renderer/activity-tabs/activity-tabs-row-estimate' // pilot-hook: activity-tabs-row-estimate

/** One row of the virtualized Activity list: a group header or a thread. */
export type ActivityVirtualItemDescriptor =
  | { type: 'header'; group: ActivityThreadGroup }
  | { type: 'thread'; thread: AgentPaneThread; groupKey: string }
  | ActivityTabsVirtualItem // pilot-hook: activity-tabs-row-type

export const ACTIVITY_HEADER_ROW_ESTIMATE = 32
export const ACTIVITY_THREAD_ROW_COMPACT_ESTIMATE = 96
export const ACTIVITY_THREAD_ROW_FULL_ESTIMATE = 116

/**
 * Flatten grouped threads into a single virtualizable row list, honoring
 * collapsed groups (their thread rows are omitted entirely).
 */
export function buildActivityVirtualItems(args: {
  groups: readonly ActivityThreadGroup[]
  groupBy: ActivityGroupBy
  collapsedGroupKeys: ReadonlySet<string>
}): ActivityVirtualItemDescriptor[] {
  const items: ActivityVirtualItemDescriptor[] = []
  for (const group of args.groups) {
    if (args.groupBy !== 'none') {
      items.push({ type: 'header', group })
      if (args.collapsedGroupKeys.has(group.key)) {
        continue
      }
    }
    for (const thread of group.threads) {
      items.push({ type: 'thread', thread, groupKey: group.key })
    }
    items.push(...activityTabsGroupRows(group)) // pilot-hook: activity-tabs-rows
  }
  return items
}

/** Stable per-row key: group key for headers, paneKey for threads. */
export function getActivityVirtualItemKey(item: ActivityVirtualItemDescriptor): string {
  if (item.type === 'workspace-tab') {
    return activityTabsRowKey(item) // pilot-hook: activity-tabs-row-key
  }
  return item.type === 'header' ? `h:${item.group.key}` : `t:${item.thread.paneKey}`
}

export function estimateActivityVirtualItemSize(
  item: ActivityVirtualItemDescriptor | undefined,
  compactMode: boolean
): number {
  const pilotEstimate = activityTabsItemEstimate(item) // pilot-hook: activity-tabs-row-estimate
  if (pilotEstimate !== null) {
    return pilotEstimate
  }
  if (!item || item.type === 'header') {
    return ACTIVITY_HEADER_ROW_ESTIMATE
  }
  return compactMode ? ACTIVITY_THREAD_ROW_COMPACT_ESTIMATE : ACTIVITY_THREAD_ROW_FULL_ESTIMATE
}

/** Index of the selected thread's row, or null; kept mounted so activation and focus survive scrolling. */
export function findActivityThreadItemIndex(
  items: readonly ActivityVirtualItemDescriptor[],
  paneKey: string | null
): number | null {
  if (paneKey === null) {
    return null
  }
  const index = items.findIndex((item) => item.type === 'thread' && item.thread.paneKey === paneKey)
  return index === -1 ? null : index
}

/** Indexes of header rows, for sticky-header resolution. */
export function getActivityHeaderItemIndexes(
  items: readonly ActivityVirtualItemDescriptor[]
): number[] {
  const indexes: number[] = []
  items.forEach((item, index) => {
    if (item.type === 'header') {
      indexes.push(index)
    }
  })
  return indexes
}
