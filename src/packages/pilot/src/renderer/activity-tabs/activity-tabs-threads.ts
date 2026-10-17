import { useEffect } from 'react'
import { create } from 'zustand'
import { useAppStore } from '@/store'
import { isPaletteCurrentWorktree } from '@/lib/palette-repo-resolution'
import {
  isClientHostedBrowserRowSelectionLive,
  useClientHostedBrowserRowSelection
} from '@/lib/pane-manager/client-hosted-browser-row-state'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import { useActivityTabsVisible } from './activity-tabs-setting'

const NO_THREADS: readonly AgentPaneThread[] = []

// The panel skips terminals Activity already lists as agents; it reads them here.
export const useActivityTabsThreadSnapshot = create<{ threads: readonly AgentPaneThread[] }>(
  () => ({ threads: NO_THREADS })
)

// The agent thread behind the active workspace tab, so its row reads as current.
export function useActiveWorkspaceThread(
  threads: readonly AgentPaneThread[],
  preferredPaneKey: string | null
): string | null {
  const clientBrowserSelection = useClientHostedBrowserRowSelection()
  return useAppStore((state) => {
    const worktreeId = state.activeWorktreeId
    if (!worktreeId || state.activeView !== 'terminal') {
      return null
    }
    const groups = state.groupsByWorktree[worktreeId] ?? []
    const group = groups.find((g) => g.id === state.activeGroupIdByWorktree[worktreeId])
    if (
      clientBrowserSelection?.worktreeId === worktreeId &&
      clientBrowserSelection.groupId === group?.id &&
      isClientHostedBrowserRowSelectionLive(clientBrowserSelection, groups)
    ) {
      return null
    }
    const tab = state.unifiedTabsByWorktree[worktreeId]?.find((t) => t.id === group?.activeTabId)
    if (!tab || (tab.contentType !== 'terminal' && tab.contentType !== 'agent-session')) {
      return null
    }
    const backingId = tab.contentType === 'agent-session' ? tab.id : tab.entityId
    const matches = (thread: AgentPaneThread) =>
      thread.tab.id === backingId &&
      isPaletteCurrentWorktree(thread.worktree, worktreeId, state.activeWorkspaceExecutionHostId)
    return (
      (
        threads.find((thread) => thread.paneKey === preferredPaneKey && matches(thread)) ??
        threads.find(matches)
      )?.paneKey ?? null
    )
  })
}

// pilot-hook: activity-tabs-threads. Wraps useAgentPaneThreads in the Activity sidebar.
export function useActivityTabsThreads<
  T extends { allThreads: AgentPaneThread[]; effectiveSelectedPaneKey: string | null }
>(result: T): T {
  const visible = useActivityTabsVisible()
  const activePaneKey = useActiveWorkspaceThread(result.allThreads, result.effectiveSelectedPaneKey)
  useEffect(() => {
    useActivityTabsThreadSnapshot.setState({ threads: visible ? result.allThreads : NO_THREADS })
  }, [visible, result.allThreads])
  return visible ? { ...result, effectiveSelectedPaneKey: activePaneKey } : result
}
