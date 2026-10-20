import { useContext, type ReactNode } from 'react'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { ActivityRowGroupContext } from '../activity-tabs/activity-row-group-context'
import { pilotStore } from '../store'
import { WorktreeLinkChips } from './WorktreeLinkChips'

// pilot-hook: activity-tabs-footer-label. Grouped by worktree the header already names the worktree,
// so a row's footer shows its MR and Linear links instead; grouped otherwise it keeps upstream's name.
export function ActivityTabsFooterLabel({
  worktree,
  repo,
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
  return (
    <span className="flex min-w-0 flex-1 items-center">
      <WorktreeLinkChips worktree={worktree} repo={repo} />
    </span>
  )
}
