import type { ReactNode } from 'react'
import { pilotStore } from '../store'
import { ActivityRowGroupContext } from './activity-row-group-context'
import { INACTIVE_WORKTREES_GROUP_KEY } from './activity-tabs-rows'
import { useWorktreeGroupNestDepth } from './worktree-nest-parent'

// Each reaches into its row's bottom padding (a header's pb-1, a row's pb-0.5), so the line runs unbroken.
const ROW_GUIDE =
  '-mb-0.5 ml-3 border-l border-[var(--pilot-activity-guide,var(--border))] pb-0.5 pl-1.5'
const HEADER_GUIDE =
  '-mb-1 ml-3 border-l border-[var(--pilot-activity-guide,var(--border))] pb-1 pl-1.5'

/** `depth` guide lines, outermost first: a child worktree's header sits on its ancestors' lines,
 *  and its rows on its own line too. */
export function NestGuides({
  depth,
  header,
  children
}: {
  depth: number
  header: boolean
  children: ReactNode
}): ReactNode {
  if (depth <= 0) {
    return children
  }
  return (
    <div className={header ? HEADER_GUIDE : ROW_GUIDE}>
      <NestGuides depth={depth - 1} header={header}>
        {children}
      </NestGuides>
    </div>
  )
}

// pilot-hook: activity-tabs-nest. A worktree group's rows (and Inactive's) sit indented on a guide
// line under the header's folder icon, so where one worktree's sessions end is easy to see. It sits
// inside the row's spacer (the context menu's trigger), reaching into its bottom padding so the line
// runs unbroken. The line takes the terminal theme's accent (window-appearance.ts). Its rows learn
// their group from ActivityRowGroupContext. A child worktree's rows also sit on its parent's line.
export function ActivityTabsNest({
  groupKey,
  children
}: {
  groupKey: string
  children: ReactNode
}): ReactNode {
  const depth = useWorktreeGroupNestDepth(groupKey)
  if (
    !pilotStore() ||
    !(groupKey.startsWith('worktree:') || groupKey === INACTIVE_WORKTREES_GROUP_KEY)
  ) {
    return children
  }
  return (
    <ActivityRowGroupContext.Provider value={groupKey}>
      <NestGuides depth={depth + 1} header={false}>
        {children}
      </NestGuides>
    </ActivityRowGroupContext.Provider>
  )
}
