import { GitBranch } from 'lucide-react'
import { MiddleCutText } from './MiddleCutText'

/** A worktree's branch under its chips, cut in the middle so its ticket prefix and last words stay. */
export function WorktreeBranchLine({ branch }: { branch: string }): React.JSX.Element {
  return (
    <span className="flex h-4 min-w-0 items-center gap-1 text-2xs text-muted-foreground">
      <GitBranch className="size-3 shrink-0" />
      <MiddleCutText text={branch} tail={2} separator="-" className="min-w-0 font-mono" />
    </span>
  )
}
