import type { ActivityVirtualItemDescriptor } from '@/components/activity/activity-thread-virtual-items'
import { pilotStore } from '../store'
import { INACTIVE_WORKTREES_GROUP_KEY } from './activity-tabs-rows'

// Measured in the Activity sidebar: a one-line row with its spacer, a worktree header with its chip
// strip, Inactive's header, and a recent worktree's row with its strip.
const ONE_LINE_ROW = 32
const WORKTREE_HEADER = 62
const INACTIVE_HEADER = 36
const RECENT_WORKTREE_ROW = 56

// pilot-hook: activity-tabs-row-estimate. With Pilot attached, rows the virtual list hasn't measured
// yet take Pilot's own heights, not upstream's three-line card, so a restored scroll lands where it
// was left. Null keeps upstream's estimate.
export function activityTabsItemEstimate(
  item: ActivityVirtualItemDescriptor | undefined
): number | null {
  if (!item || !pilotStore()) {
    return null
  }
  if (item.type === 'header') {
    if (item.group.key === INACTIVE_WORKTREES_GROUP_KEY) {
      return INACTIVE_HEADER
    }
    return item.group.key.startsWith('worktree:') ? WORKTREE_HEADER : null
  }
  if (item.type === 'workspace-tab' && item.row.kind === 'recent-worktree') {
    return RECENT_WORKTREE_ROW
  }
  return ONE_LINE_ROW
}
