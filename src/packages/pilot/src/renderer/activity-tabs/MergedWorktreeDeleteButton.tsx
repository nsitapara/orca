import type React from 'react'
import { Trash2 } from 'lucide-react'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import { runWorktreeContextMenuDeleteIntent } from '@/components/sidebar/worktree-context-menu-delete-intent'
import { getReviewLabel } from '@/components/sidebar/worktree-review-helpers'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useWorktreeLinks } from '../activity-card/worktree-links'

// Once its MR/PR is merged a worktree is ready to go, so its row shows Delete at rest. The click is the
// Projects menu's own Delete: its confirmation, skip-confirm and child-workspace guards.
export function MergedWorktreeDeleteButton({
  worktree,
  repo
}: {
  worktree: Worktree
  repo: Repo | null
}): React.JSX.Element | null {
  const { review } = useWorktreeLinks(worktree, repo)
  if (review?.state !== 'merged') {
    return null
  }
  const { id, instanceId, hostId } = worktree
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label="Delete worktree"
          onClick={(event) => {
            event.stopPropagation()
            runWorktreeContextMenuDeleteIntent({
              kind: 'worktree',
              worktree: { id, instanceId, hostId }
            })
          }}
          onKeyDown={(event) => event.stopPropagation()}
          className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Trash2 className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Delete worktree — {getReviewLabel(review)} merged</TooltipContent>
    </Tooltip>
  )
}
