import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { isPaletteCurrentWorktree } from '@/lib/palette-repo-resolution'
import {
  isClientHostedBrowserRowSelectionLive,
  useClientHostedBrowserRowSelection
} from '@/lib/pane-manager/client-hosted-browser-row-state'
import type {
  ActivityGroupBy,
  ActivityThreadGroup,
  AgentPaneThread,
  ThreadReadFilter
} from '@/components/activity/activity-thread-types'
import { mergeTabsIntoGroups } from './activity-tabs-groups'
import { useActivityTabsVisible } from './activity-tabs-setting'
import { useOpenTabItems } from './use-open-tab-items'

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

export type ActivityTabsView = {
  query: string
  readFilter: ThreadReadFilter
  groupBy: ActivityGroupBy
}

// pilot-hook: activity-tabs-threads. Wraps useAgentPaneThreads in the Activity sidebar: while
// "Show all tabs" is on, every other open tab joins the agents' groups and the active tab's agent
// reads as current.
export function useActivityTabsThreads<
  T extends {
    allThreads: AgentPaneThread[]
    effectiveSelectedPaneKey: string | null
    visibleThreadGroups: ActivityThreadGroup[]
  }
>(result: T, view: ActivityTabsView): T {
  const visible = useActivityTabsVisible()
  const activePaneKey = useActiveWorkspaceThread(result.allThreads, result.effectiveSelectedPaneKey)
  // A tab is never unread, so "Show unread only" leaves it out.
  const tabs = useOpenTabItems(visible && view.readFilter === 'all', view.query, result.allThreads)
  const visibleThreadGroups = useMemo(
    () => mergeTabsIntoGroups(result.visibleThreadGroups, tabs, view.groupBy),
    [result.visibleThreadGroups, tabs, view.groupBy]
  )
  return visible
    ? { ...result, effectiveSelectedPaneKey: activePaneKey, visibleThreadGroups }
    : result
}
