import { ChevronRight } from 'lucide-react'
import { useAppStore } from '@/store'
import { pilotStore } from '../store'
import { useActivityShowAllTabs } from './activity-tabs-setting'

function useActiveWorkspaceNames(): { project: string | null; worktree: string | null } {
  const worktree = useAppStore((s) =>
    s.activeWorktreeId
      ? (s.getKnownWorktreeById(
          s.activeWorktreeId,
          s.activeWorkspaceExecutionHostId ?? undefined
        ) ?? null)
      : null
  )
  const project = useAppStore(
    (s) => s.repos.find((repo) => repo.id === worktree?.repoId)?.displayName ?? null
  )
  return { project, worktree: worktree?.displayName ?? null }
}

// pilot-hook: activity-tabs-panel. While "Show all tabs" is on, the selected project and worktree
// head Activity's list; the tab bar keeps the new tab and agent actions.
export function ActivityTabsPanel(): React.JSX.Element | null {
  const on = useActivityShowAllTabs()
  const names = useActiveWorkspaceNames()
  if (!on || !pilotStore() || !names.worktree) {
    return null
  }
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border px-2 py-1.5 text-xs">
      {names.project ? (
        <>
          <span className="min-w-0 shrink truncate text-muted-foreground" title={names.project}>
            {names.project}
          </span>
          <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
        </>
      ) : null}
      <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={names.worktree}>
        {names.worktree}
      </span>
    </div>
  )
}
