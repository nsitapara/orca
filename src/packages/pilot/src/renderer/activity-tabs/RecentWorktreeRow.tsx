import { FolderGit2 } from 'lucide-react'
import { toast } from 'sonner'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import { getActivityThreadWorkspaceTitle } from '@/lib/activity-thread-display'
import { getPaletteWorktreeExecutionHostId } from '@/lib/palette-repo-resolution'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { NewAgentMenu } from './NewAgentMenu'
import type { RecentWorktreeItem } from './recent-worktree-items'

function tabCountLabel(count: number): string {
  if (count === 0) {
    return 'No open tabs'
  }
  return count === 1 ? '1 open tab' : `${count} open tabs`
}

function open({ worktree }: RecentWorktreeItem): void {
  const executionHostId = getPaletteWorktreeExecutionHostId(worktree)
  const opened = executionHostId
    ? activateAndRevealWorkspace(worktree.id, { executionHostId, revealInSidebar: false })
    : activateAndRevealWorkspace(worktree.id, { revealInSidebar: false })
  if (!opened) {
    toast.error('This worktree is no longer available.')
  }
}

// Laid out like a tab's row; its own New agent starts a session there without opening it first.
export function RecentWorktreeRow({ item }: { item: RecentWorktreeItem }): React.JSX.Element {
  const workspaceLabel = getActivityThreadWorkspaceTitle(item.worktree)
  const label = tabCountLabel(item.openTabCount)
  return (
    <div
      data-worktree-card-surface="true"
      data-activity-recent-worktree={item.key}
      onClick={() => open(item)}
      role="listitem"
      aria-label={`${workspaceLabel}: ${label}`}
      className="group relative flex w-full cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-1.5 py-1.5 text-left transition-[background-color,border-color,opacity,box-shadow] duration-200 outline-none select-none worktree-sidebar-card-hover focus-visible:ring-1 focus-visible:ring-ring"
    >
      <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
        <FolderGit2 className="size-3.5" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium leading-5 text-muted-foreground">
          {label}
        </span>
        <span className="truncate text-2xs text-muted-foreground" title={workspaceLabel}>
          {workspaceLabel} · active {formatRelativeTime(item.worktree.lastActivityAt)}
        </span>
      </div>
      <NewAgentMenu worktreeId={item.worktree.id} />
    </div>
  )
}
