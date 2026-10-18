import { toast } from 'sonner'
import { getPaletteWorktreeExecutionHostId } from '@/lib/palette-repo-resolution'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import type { Worktree } from '../../../../../shared/worktree/types'

// A click in Activity is a user open, so an empty worktree gets the user's default surface, as in Projects.
export function openActivityWorktree(worktree: Worktree): void {
  const executionHostId = getPaletteWorktreeExecutionHostId(worktree)
  const opened = activateAndRevealWorkspace(worktree.id, {
    navigationIntent: 'user-open',
    revealInSidebar: false,
    ...(executionHostId ? { executionHostId } : {})
  })
  if (!opened) {
    toast.error('This worktree is no longer available.')
  }
}
