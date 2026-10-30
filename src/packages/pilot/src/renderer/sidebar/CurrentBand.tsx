import { Crosshair } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { projectGroupIdFromRepoId } from '../../../../../shared/folder-workspace-worktree'
import { useBranchLinearIssue } from '../activity-card/linear-branch-issue'
import { worktreeParentOf } from '../activity-tabs/worktree-nest-parent'
import { CurrentSessionRow } from './CurrentSessionRow'
import { useLocateSelectedWorktree } from './locate-worktree'
import './sidebar-selection.css'

/** What follows "Current ·": the project, then the parent's ticket (or name) for a sub-issue worktree. */
export function currentPath(parts: {
  project: string | null
  parent: { ticket: string | null; name: string } | null
}): string[] {
  const parent = parts.parent ? (parts.parent.ticket ?? parts.parent.name) : null
  return [parts.project, parent].filter((part): part is string => Boolean(part))
}

function useCurrentWorktree() {
  const worktree = useAppStore((s) =>
    s.activeWorktreeId
      ? (s.getKnownWorktreeById(
          s.activeWorktreeId,
          s.activeWorkspaceExecutionHostId ?? undefined
        ) ?? null)
      : null
  )
  // A folder workspace's repoId names its project group.
  const folderGroupId = projectGroupIdFromRepoId(worktree?.repoId)
  const project = useAppStore((s) =>
    folderGroupId
      ? (s.projectGroups.find((group) => group.id === folderGroupId)?.name ?? null)
      : (s.repos.find((repo) => repo.id === worktree?.repoId)?.displayName ?? null)
  )
  const parent = useAppStore((s) => {
    const found = worktree && !folderGroupId ? worktreeParentOf(s)(worktree.id) : null
    return found ? (s.getKnownWorktreeById(found.id) ?? null) : null
  })
  return { worktree, project, parent }
}

/**
 * The current worktree above the list, in either sidebar view: "Current · project › parent ticket" and
 * a locate button, the whole name in larger type (wrapped, never cut), then its open session. A folder
 * workspace shows only its project.
 */
export function CurrentBand(): React.JSX.Element | null {
  const { worktree, project, parent } = useCurrentWorktree()
  const parentTicket = useBranchLinearIssue(parent?.branch)?.identifier ?? null
  const body = useAppStore((s) => s.sidebarBody ?? 'workspaces')
  const locate = useLocateSelectedWorktree(worktree?.id ?? null, body)
  if (!worktree) {
    return null
  }
  const path = currentPath({
    project,
    parent: parent ? { ticket: parentTicket, name: parent.displayName } : null
  })
  return (
    <section
      aria-label="Current worktree"
      className="pilot-current-band flex min-w-0 shrink-0 flex-col gap-1 px-3 pt-2 pb-2.5"
    >
      <div className="flex min-w-0 items-center gap-1 text-2xs text-muted-foreground">
        <span className="pilot-selected-label shrink-0 font-semibold uppercase tracking-[0.05em]">
          Current
        </span>
        {path.length > 0 ? (
          <span className="min-w-0 truncate" title={path.join(' › ')}>
            {`· ${path.join(' › ')}`}
          </span>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="ml-auto shrink-0"
              aria-label="Show in list"
              onClick={locate}
            >
              <Crosshair className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            Show in list
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="min-w-0 break-words text-base font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
        {worktree.displayName}
      </div>
      <CurrentSessionRow worktreeId={worktree.id} onLocate={locate} />
    </section>
  )
}
