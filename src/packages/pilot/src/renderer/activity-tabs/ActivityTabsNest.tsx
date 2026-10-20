import type { ReactNode } from 'react'
import { pilotStore } from '../store'
import { INACTIVE_WORKTREES_GROUP_KEY } from './activity-tabs-rows'

// pilot-hook: activity-tabs-nest. A worktree group's rows (and Inactive's) sit indented on a guide
// line under the header's folder icon, so where one worktree's sessions end is easy to see. It sits
// inside the row's spacer (the context menu's trigger), reaching into its bottom padding so the line
// runs unbroken. The line takes the terminal theme's accent (window-appearance.ts).
export function ActivityTabsNest({
  groupKey,
  children
}: {
  groupKey: string
  children: ReactNode
}): ReactNode {
  if (
    !pilotStore() ||
    !(groupKey.startsWith('worktree:') || groupKey === INACTIVE_WORKTREES_GROUP_KEY)
  ) {
    return children
  }
  return (
    <div className="-mb-0.5 ml-3 border-l border-[var(--pilot-activity-guide,var(--border))] pb-0.5 pl-1.5">
      {children}
    </div>
  )
}
