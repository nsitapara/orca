import { useContext, type ReactNode } from 'react'
import { getActivityThreadWorkspaceTitle } from '@/lib/activity-thread-display'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { ActivityMachineChip } from '../activity-machines/ActivityMachineChip'
import { ActivityRowGroupContext } from './activity-row-group-context'

/**
 * Where a one-line row runs: its machine (while the list spans machines) and its worktree. Grouped by
 * worktree the header already names both, so the row shows neither.
 */
export function RowWorkspaceLabel({
  worktree,
  repo
}: {
  worktree: Worktree
  repo: Repo | null
}): ReactNode {
  const groupKey = useContext(ActivityRowGroupContext)
  if (groupKey?.startsWith('worktree:')) {
    return null
  }
  const label = getActivityThreadWorkspaceTitle(worktree)
  return (
    <>
      <ActivityMachineChip worktree={worktree} repo={repo} />
      <span
        className="min-w-0 max-w-[40%] shrink truncate text-2xs text-muted-foreground"
        title={label}
      >
        {label}
      </span>
    </>
  )
}
