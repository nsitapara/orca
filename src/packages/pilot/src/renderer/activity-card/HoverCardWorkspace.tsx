import { useCallback } from 'react'
import { Copy, FolderGit2, FolderOpen, GitBranch, LocateFixed } from 'lucide-react'
import { toast } from 'sonner'
import { getWorktreeExecutionHostId } from '../../../../../shared/execution-host'
import { getWorktreeGitIdentityDisplay } from '../../../../../shared/worktree/git-identity-display'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import {
  WorktreeCardDetailSection,
  WorktreeCardDetailSectionContent
} from '@/components/sidebar/WorktreeCardDetailSection'
import { DetailHeader, MetadataActionIcon } from '@/components/sidebar/WorktreeCardMetadataControls'
import { getActivityThreadWorkspaceTitle } from '@/lib/activity-thread-display'
import { isRevealOrEditorOpenBlocked } from '@/lib/local-path-open-guard'
import { getRevealInFileManagerLabel, revealInFileManager } from '@/lib/reveal-in-file-manager'
import { jumpToWorktreeFromSidebar } from '@/lib/worktree-jump-navigation'
import { useAppStore } from '@/store'
import { ActivityMachineChip } from '../activity-machines/ActivityMachineChip'

async function copyPath(path: string): Promise<void> {
  try {
    await window.api.ui.writeClipboardText(path)
    toast.success('Path copied to clipboard')
  } catch {
    toast.error('Failed to copy path')
  }
}

/** Upstream's Workspace section, plus Reveal in Finder (or the platform's file manager). */
export function HoverCardWorkspace({
  thread,
  onJumpToWorkspace,
  canJumpToWorkspace,
  closeHover
}: {
  thread: AgentPaneThread
  onJumpToWorkspace?: (thread: AgentPaneThread) => void
  canJumpToWorkspace?: boolean
  closeHover: () => void
}): React.JSX.Element {
  const { worktree, repo } = thread
  const executionHostId = getWorktreeExecutionHostId(worktree, repo ?? undefined)
  const isKnownWorktree = useAppStore((s) =>
    Boolean(s.getKnownWorktreeById(worktree.id, executionHostId))
  )
  const canJump = canJumpToWorkspace ?? isKnownWorktree
  // Remote paths can't open in this computer's file manager; the button only shows where it works.
  const canReveal = Boolean(worktree.path) && !isRevealOrEditorOpenBlocked(executionHostId)
  const identity = getWorktreeGitIdentityDisplay(worktree)
  const revealLabel = getRevealInFileManagerLabel()

  const jump = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation()
      closeHover()
      if (onJumpToWorkspace) {
        onJumpToWorkspace(thread)
        return
      }
      const state = useAppStore.getState()
      if (state.getKnownWorktreeById(worktree.id, executionHostId)) {
        state.acknowledgeAgents([thread.paneKey], undefined, 'explicit')
        jumpToWorktreeFromSidebar(worktree.id, { executionHostId })
      }
    },
    [closeHover, executionHostId, onJumpToWorkspace, thread, worktree.id]
  )

  return (
    <WorktreeCardDetailSection>
      <DetailHeader
        icon={<FolderGit2 className="size-3 text-muted-foreground" />}
        label="Workspace"
        actions={
          <>
            {canReveal ? (
              <MetadataActionIcon
                label={revealLabel}
                onClick={() => void revealInFileManager(worktree.path, executionHostId)}
              >
                <FolderOpen className="size-3" />
              </MetadataActionIcon>
            ) : null}
            {canJump ? (
              <MetadataActionIcon label="Jump to workspace" onClick={jump}>
                <LocateFixed className="size-3" />
              </MetadataActionIcon>
            ) : null}
          </>
        }
      />
      <WorktreeCardDetailSectionContent className="space-y-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {repo ? (
            <div className="flex shrink-0 items-center gap-1 rounded-[4px] border border-border bg-accent px-1.5 py-0.5 dark:border-border/60 dark:bg-accent/50">
              <RepoBadgeMark color={repo.badgeColor} />
              <span className="max-w-[7rem] truncate text-[10px] font-semibold lowercase text-foreground">
                {repo.displayName}
              </span>
            </div>
          ) : null}
          <ActivityMachineChip worktree={worktree} repo={repo} />
          <span className="truncate text-[12.5px] font-semibold text-foreground">
            {getActivityThreadWorkspaceTitle(worktree)}
          </span>
        </div>
        {identity ? (
          <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <GitBranch className="size-3 shrink-0" />
            <span className="truncate">
              {identity.kind === 'branch' ? identity.branchName : identity.sidebarLabel}
            </span>
          </div>
        ) : null}
        {worktree.path ? (
          <div className="flex items-center justify-between gap-1.5 rounded border border-border/30 bg-accent/40 px-2 py-1 font-mono text-[10.5px] text-muted-foreground">
            <span className="truncate" title={worktree.path}>
              {worktree.path}
            </span>
            <MetadataActionIcon label="Copy path" onClick={() => void copyPath(worktree.path)}>
              <Copy className="size-2.5" />
            </MetadataActionIcon>
          </div>
        ) : null}
      </WorktreeCardDetailSectionContent>
    </WorktreeCardDetailSection>
  )
}
