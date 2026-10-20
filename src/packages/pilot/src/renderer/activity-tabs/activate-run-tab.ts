import { useAppStore } from '@/store'
import type { RunTab } from '../../shared/api-types-capacity'
import { activateWorkspaceTab } from './activate-workspace-tab'

// Opens a run's agent tab the way Activity does; false when its worktree or tab is gone.
export function activateRunTab({ worktreePath, tabId }: RunTab): boolean {
  const state = useAppStore.getState()
  const worktree = state.allWorktrees().find((w) => w.path === worktreePath)
  const tab = worktree
    ? state.unifiedTabsByWorktree[worktree.id]?.find(
        (t) => t.contentType === 'terminal' && t.entityId === tabId
      )
    : undefined
  if (!worktree || !tab) {
    return false
  }
  return activateWorkspaceTab({ key: tab.id, tab, worktree, repo: null, label: tab.label })
}
