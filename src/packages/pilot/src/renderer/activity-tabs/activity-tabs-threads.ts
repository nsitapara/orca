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
import { mergeRowsIntoGroups } from './activity-tabs-groups'
import type { ActivityTabsRow } from './activity-tabs-rows'
import { useActivityRecentWorktreesVisible, useActivityTabsVisible } from './activity-tabs-setting'
import { useOpenTabItems } from './use-open-tab-items'
import { useRecentWorktreeItems } from './use-recent-worktree-items'

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
// reads as current; while "Show recently active worktrees" is on, each such worktree with no row
// gets one to start a session from.
export function useActivityTabsThreads<
  T extends {
    allThreads: AgentPaneThread[]
    effectiveSelectedPaneKey: string | null
    visibleThreadGroups: ActivityThreadGroup[]
  }
>(result: T, view: ActivityTabsView): T {
  const tabsVisible = useActivityTabsVisible()
  const recentVisible = useActivityRecentWorktreesVisible()
  const activePaneKey = useActiveWorkspaceThread(result.allThreads, result.effectiveSelectedPaneKey)
  // A tab or a worktree is never unread, so "Show unread only" leaves them out.
  const listsAll = view.readFilter === 'all'
  const tabs = useOpenTabItems(tabsVisible && listsAll, view.query, result.allThreads)
  const visibleThreads = useMemo(
    () => result.visibleThreadGroups.flatMap((group) => group.threads),
    [result.visibleThreadGroups]
  )
  const recent = useRecentWorktreeItems(recentVisible && listsAll, view.query, visibleThreads, tabs)
  const visibleThreadGroups = useMemo(() => {
    const rows: ActivityTabsRow[] = [
      ...tabs.map((tab): ActivityTabsRow => ({ kind: 'tab', tab })),
      ...recent.map((item): ActivityTabsRow => ({ kind: 'recent-worktree', recent: item }))
    ]
    return mergeRowsIntoGroups(result.visibleThreadGroups, rows, view.groupBy)
  }, [result.visibleThreadGroups, tabs, recent, view.groupBy])
  if (!tabsVisible && !recentVisible) {
    return result
  }
  return {
    ...result,
    ...(tabsVisible ? { effectiveSelectedPaneKey: activePaneKey } : {}),
    visibleThreadGroups
  }
}
