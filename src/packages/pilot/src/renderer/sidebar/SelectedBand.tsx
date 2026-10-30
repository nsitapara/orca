import { Crosshair, FolderGit2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { useBranchLinearIssue } from '../activity-card/linear-branch-issue'
import { worktreeParentOf } from '../activity-tabs/worktree-nest-parent'
import { useLocateSelectedWorktree } from './locate-worktree'
import './sidebar-selection.css'

/** The crumbs before the name: project, then the parent's ticket (or name), then this one's ticket. */
export function selectedCrumbs(parts: {
  project: string | null
  parent: { ticket: string | null; name: string } | null
  ticket: string | null
}): string[] {
  const parent = parts.parent ? (parts.parent.ticket ?? parts.parent.name) : null
  return [parts.project, parent, parts.ticket].filter((part): part is string => Boolean(part))
}

function useSelectedWorktree() {
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
  const parent = useAppStore((s) => {
    const found = worktree ? worktreeParentOf(s)(worktree.id) : null
    return found ? (s.getKnownWorktreeById(found.id) ?? null) : null
  })
  return { worktree, project, parent }
}

/**
 * The selected worktree above the list, in either sidebar view: "Selected · project › parent ticket ›
 * ticket" and a locate button, then the whole name, wrapped rather than cut. A folder workspace has
 * no branch, so only its project leads it. Replaces the Activity list's breadcrumb.
 */
export function SelectedBand(): React.JSX.Element | null {
  const { worktree, project, parent } = useSelectedWorktree()
  const ticket = useBranchLinearIssue(worktree?.branch)?.identifier ?? null
  const parentTicket = useBranchLinearIssue(parent?.branch)?.identifier ?? null
  const body = useAppStore((s) => s.sidebarBody ?? 'workspaces')
  const locate = useLocateSelectedWorktree(worktree?.id ?? null, body)
  if (!worktree) {
    return null
  }
  const crumbs = selectedCrumbs({
    project,
    parent: parent ? { ticket: parentTicket, name: parent.displayName } : null,
    ticket
  })
  return (
    <section
      aria-label="Selected worktree"
      className="mx-2 mt-1.5 flex min-w-0 shrink-0 flex-col gap-0.5 border-y border-worktree-sidebar-border/60 px-2 py-1.5"
    >
      <div className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <span className="pilot-selected-label shrink-0 font-semibold">Selected</span>
        {crumbs.length > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate" title={crumbs.join(' › ')}>
              {crumbs.join(' › ')}
            </span>
          </>
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
      <div className="flex min-w-0 items-start gap-1.5 text-[13px] font-semibold text-foreground">
        <FolderGit2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{worktree.displayName}</span>
      </div>
    </section>
  )
}
