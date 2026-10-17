import type { ReactNode } from 'react'
import { pilotStore } from '../store'

// pilot-hook: activity-tabs-nest. A worktree group's rows sit indented on a guide line under its
// header, so where one worktree's sessions end is easy to see. It sits inside the row's spacer
// (the context menu's trigger), reaching into its bottom padding so the line runs unbroken.
export function ActivityTabsNest({
  groupKey,
  children
}: {
  groupKey: string
  children: ReactNode
}): ReactNode {
  if (!pilotStore() || !groupKey.startsWith('worktree:')) {
    return children
  }
  return <div className="-mb-0.5 ml-2 border-l border-border pb-0.5 pl-1.5">{children}</div>
}
