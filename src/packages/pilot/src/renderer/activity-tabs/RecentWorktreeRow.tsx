import { FolderGit2, Pin } from 'lucide-react'
import { toast } from 'sonner'
import { getActivityThreadWorkspaceTitle } from '@/lib/activity-thread-display'
import { getPaletteWorktreeExecutionHostId } from '@/lib/palette-repo-resolution'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { NewAgentMenu } from './NewAgentMenu'
import type { RecentWorktreeItem } from './recent-worktree-items'

function open({ worktree }: RecentWorktreeItem): void {
  const executionHostId = getPaletteWorktreeExecutionHostId(worktree)
  const opened = executionHostId
    ? activateAndRevealWorkspace(worktree.id, { executionHostId, revealInSidebar: false })
    : activateAndRevealWorkspace(worktree.id, { revealInSidebar: false })
  if (!opened) {
    toast.error('This worktree is no longer available.')
  }
}

// Grouped by anything but worktree there is no header to start a session from: one line, the
// worktree and its New agent. Grouped by worktree, the header stands in for it.
export function RecentWorktreeRow({ item }: { item: RecentWorktreeItem }): React.JSX.Element {
  const workspaceLabel = getActivityThreadWorkspaceTitle(item.worktree)
  return (
    <div
      data-worktree-card-surface="true"
      data-activity-recent-worktree={item.key}
      onClick={() => open(item)}
      role="listitem"
      aria-label={workspaceLabel}
      className="group relative flex w-full cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-1.5 py-1 text-left transition-[background-color,border-color,opacity,box-shadow] duration-200 outline-none select-none worktree-sidebar-card-hover focus-visible:ring-1 focus-visible:ring-ring"
    >
      <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
      <span
        className="min-w-0 flex-1 truncate text-[13px] leading-5 text-muted-foreground"
        title={workspaceLabel}
      >
        {workspaceLabel}
      </span>
      {item.pinned ? (
        <Pin className="size-2.5 shrink-0 text-muted-foreground" aria-label="Pinned" />
      ) : null}
      <NewAgentMenu worktreeId={item.worktree.id} />
    </div>
  )
}
