import type React from 'react'
import { FileText } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { Worktree } from '../../../../../shared/worktree/types'
import { WORKTREE_CHIP_CLASS } from '../activity-card/worktree-chip-class'
import { openActivityWorktree } from '../activity-tabs/open-activity-worktree'
import { pilotStore } from '../store'
import { useWorktreeArtifacts } from './artifacts-feed'
import { setArtifactsFoldOpen } from './artifacts-view'

// Projects' cards size their chips smaller than Activity's (its "N children" chip).
const PROJECTS_CHIP_CLASS =
  'inline-flex h-[18px] shrink-0 cursor-pointer items-center gap-1 rounded-md border border-worktree-sidebar-border bg-worktree-sidebar px-1.5 text-3xs font-medium leading-none tabular-nums text-muted-foreground transition-colors hover:bg-worktree-sidebar-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring'

export function artifactsChipLabel(count: number): string {
  return count === 1 ? '1 artifact' : `${count} artifacts`
}

// The chip sits inside the worktree's own row, which opens it on click or Enter: the chip does that itself.
function stop(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

/**
 * The artifacts agents published from this worktree or folder, as a document icon and a count. A click selects the
 * worktree and opens the sidebar's Artifacts fold-out, which lists them. Nothing when there are none.
 */
export function WorktreeArtifactsChip({
  worktree,
  variant = 'activity'
}: {
  worktree: Worktree
  variant?: 'activity' | 'projects'
}): React.JSX.Element | null {
  const count = useWorktreeArtifacts(worktree).length
  if (count === 0) {
    return null
  }
  const label = artifactsChipLabel(count)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: show in the sidebar`}
          className={variant === 'projects' ? PROJECTS_CHIP_CLASS : cn(WORKTREE_CHIP_CLASS)}
          onMouseDown={stop}
          onKeyDown={stop}
          onClick={(event) => {
            event.stopPropagation()
            setArtifactsFoldOpen(true)
            openActivityWorktree(worktree)
          }}
        >
          <FileText className={variant === 'projects' ? 'size-2.5' : 'size-3'} />
          {count}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

// pilot-hook: projects-card-artifacts. The chip in a Projects card, on its own row above the "N children" chip.
// Nothing until Pilot attaches, or without artifacts.
export function ProjectsCardArtifactsChip({
  worktree
}: {
  worktree: Worktree
}): React.JSX.Element | null {
  return pilotStore() ? <ProjectsCardArtifactsRow worktree={worktree} /> : null
}

function ProjectsCardArtifactsRow({ worktree }: { worktree: Worktree }) {
  const count = useWorktreeArtifacts(worktree).length
  if (count === 0) {
    return null
  }
  return (
    <div className="relative mt-1 flex min-w-0 justify-start">
      <WorktreeArtifactsChip worktree={worktree} variant="projects" />
    </div>
  )
}
