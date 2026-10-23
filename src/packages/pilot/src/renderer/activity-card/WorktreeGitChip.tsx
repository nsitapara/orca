import type React from 'react'
import { LoaderCircle } from 'lucide-react'
import type { Worktree } from '../../../../../shared/worktree/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { openActivityWorktree } from '../activity-tabs/open-activity-worktree'
import type { WorktreeGitChipView } from './git-sync-mark'
import { WORKTREE_CHIP_CLASS } from './worktree-chip-class'
import { pushWorktreeBranch } from './worktree-git-sync-feed'

function openSourceControl(worktree: Worktree): void {
  if (!openActivityWorktree(worktree)) {
    return
  }
  const state = useAppStore.getState()
  state.setRightSidebarTab('source-control')
  state.setRightSidebarOpen(true)
}

// The chip sits inside the worktree header, which opens the worktree on click or Enter.
function stopRowEvent(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

function SyncIcon({
  view,
  pushing
}: {
  view: WorktreeGitChipView
  pushing: boolean
}): React.JSX.Element | null {
  if (pushing) {
    return <LoaderCircle className="size-3 shrink-0 animate-spin" />
  }
  if (!view.sync) {
    return null
  }
  const { Icon, tone } = view.sync
  return <Icon className={cn('size-3 shrink-0', tone)} />
}

function chipLabel(view: WorktreeGitChipView, pushing: boolean, pushes: boolean): string {
  if (pushing) {
    return 'Pushing…'
  }
  return (pushes ? view.actionLabel : null) ?? view.label
}

/**
 * The worktree's git state: its branch against origin (yellow: commits origin doesn't have, green:
 * in sync), then a dot and the count of uncommitted changes. Where `canPush`, a click on a push or
 * publish pushes the branch; any other click opens the worktree's Source Control.
 */
export function WorktreeGitChip({
  worktree,
  view,
  pushing,
  canPush
}: {
  worktree: Worktree
  view: WorktreeGitChipView
  pushing: boolean
  canPush: boolean
}): React.JSX.Element {
  const action = view.sync?.action ?? 'open'
  const pushes = canPush && (action === 'push' || action === 'publish')
  const label = chipLabel(view, pushing, pushes)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-busy={pushing}
          className={WORKTREE_CHIP_CLASS}
          onMouseDown={stopRowEvent}
          onKeyDown={stopRowEvent}
          onClick={(event) => {
            event.stopPropagation()
            if (pushing) {
              return
            }
            if (pushes) {
              void pushWorktreeBranch(worktree, action === 'publish')
            } else {
              openSourceControl(worktree)
            }
          }}
        >
          <SyncIcon view={view} pushing={pushing} />
          {view.sync?.count}
          {view.changes ? (
            <>
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full bg-[color:var(--git-decoration-modified)]"
              />
              {view.changes}
            </>
          ) : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
