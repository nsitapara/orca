import { FolderGit2, Pin } from 'lucide-react'
import WorktreeContextMenu from '@/components/sidebar/WorktreeContextMenu'
import { getActivityThreadWorkspaceTitle } from '@/lib/activity-thread-display'
import { isPortaledRowMenuClick } from '@/lib/list-row-interaction'
import { WorktreeLinksPrefetch } from '../activity-card/worktree-links'
import { ActivityMachineChip } from '../activity-machines/ActivityMachineChip'
import { MergedWorktreeDeleteButton } from './MergedWorktreeDeleteButton'
import { NewAgentMenu } from './NewAgentMenu'
import { openActivityWorktree } from './open-activity-worktree'
import type { RecentWorktreeItem } from './recent-worktree-items'

// Grouped by anything but worktree there is no header to start a session from: one line, the
// worktree and its New agent. Grouped by worktree, the header stands in for it. A right-click gives
// the worktree's menu, as in Projects; once its MR is merged, Delete shows at rest.
export function RecentWorktreeRow({ item }: { item: RecentWorktreeItem }): React.JSX.Element {
  const workspaceLabel = getActivityThreadWorkspaceTitle(item.worktree)
  return (
    <WorktreeContextMenu worktree={item.worktree}>
      <div
        data-worktree-card-surface="true"
        data-activity-recent-worktree={item.key}
        onClick={(event) => {
          // The New agent menu's pick bubbles here through its portal; it opens its own tab.
          if (!isPortaledRowMenuClick(event)) {
            openActivityWorktree(item.worktree)
          }
        }}
        role="listitem"
        aria-label={workspaceLabel}
        className="group relative flex w-full cursor-pointer items-center gap-1.5 rounded-lg border border-transparent px-1.5 py-1 text-left transition-[background-color,border-color,opacity,box-shadow] duration-200 outline-none select-none worktree-sidebar-card-hover focus-visible:ring-1 focus-visible:ring-ring"
      >
        <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
        <ActivityMachineChip worktree={item.worktree} repo={item.repo} />
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
        <WorktreeLinksPrefetch worktree={item.worktree} repo={item.repo} />
        <MergedWorktreeDeleteButton worktree={item.worktree} repo={item.repo} />
      </div>
    </WorktreeContextMenu>
  )
}
