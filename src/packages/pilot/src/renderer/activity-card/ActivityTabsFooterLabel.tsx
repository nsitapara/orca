import { useContext, type ReactNode } from 'react'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { ActivityRowGroupContext } from '../activity-tabs/activity-row-group-context'
import { pilotStore } from '../store'

// pilot-hook: activity-tabs-footer-label. Grouped by worktree the header names the worktree and
// carries its MR, Linear and ports chips, so a row's footer drops the name and keeps only its own
// state, actions and time; grouped otherwise it keeps upstream's name.
export function ActivityTabsFooterLabel({
  children
}: {
  worktree: Worktree
  repo: Repo | null
  children: ReactNode
}): ReactNode {
  const groupKey = useContext(ActivityRowGroupContext)
  if (!pilotStore() || !groupKey?.startsWith('worktree:')) {
    return children
  }
  // Keeps the row's actions and time at the right edge.
  return <span className="min-w-0 flex-1" />
}
