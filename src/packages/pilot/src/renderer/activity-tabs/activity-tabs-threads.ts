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
import {
  useActivityHideAutomationRuns,
  useActivityHideTerminals,
  useActivityInactiveExpanded,
  useActivityShowRecentWorktrees,
  useActivitySidebarAttached,
  useActivityTabsVisible
} from './activity-tabs-setting'
import {
  hostedTabsOf,
  useAutomationTabIds,
  withoutAutomationTabs,
  withoutAutomationThreads
} from './hide-automation-runs'
import { useAgentTabItems } from './hide-terminal-tabs'
import { useOpenTabItems } from './use-open-tab-items'
import { usePinnedWorktreeIds, useRecentWorktreeItems } from './use-recent-worktree-items'

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
// "Show all tabs" is on, every other open tab joins the agents' groups (less plain terminals under
// "Hide terminals") and the active tab's agent reads as current; "Hide automation runs" drops every
// session and tab a Pilot step ran in. A pinned worktree with no row always gets one to start a
// session from, and so, while "Show recently active worktrees" is on, does each
// recently active one; pinned worktrees' groups lead the worktree grouping, and worktrees with no
// session go under Inactive at its end.
export function useActivityTabsThreads<
  T extends {
    allThreads: AgentPaneThread[]
    effectiveSelectedPaneKey: string | null
    visibleThreadGroups: ActivityThreadGroup[]
  }
>(result: T, view: ActivityTabsView): T {
  const attached = useActivitySidebarAttached()
  const tabsVisible = useActivityTabsVisible()
  const recentOn = useActivityShowRecentWorktrees()
  const hideTerminals = useActivityHideTerminals()
  const hideAutomationRuns = useActivityHideAutomationRuns()
  const inactiveExpanded = useActivityInactiveExpanded()
  const pinnedIds = usePinnedWorktreeIds(attached)
  const activePaneKey = useActiveWorkspaceThread(result.allThreads, result.effectiveSelectedPaneKey)
  // A tab or a worktree is never unread, so "Show unread only" leaves them out.
  const listsAll = view.readFilter === 'all'
  const openTabs = useAgentTabItems(
    useOpenTabItems(tabsVisible && listsAll, view.query, result.allThreads),
    hideTerminals
  )
  const automationTabs = useAutomationTabIds(
    hostedTabsOf(result.allThreads, openTabs),
    attached && hideAutomationRuns
  )
  const tabs = useMemo(
    () => withoutAutomationTabs(openTabs, automationTabs),
    [openTabs, automationTabs]
  )
  const threadGroups = useMemo(
    () => withoutAutomationThreads(result.visibleThreadGroups, automationTabs),
    [result.visibleThreadGroups, automationTabs]
  )
  const visibleThreads = useMemo(
    () => threadGroups.flatMap((group) => group.threads),
    [threadGroups]
  )
  const recent = useRecentWorktreeItems(
    attached && listsAll,
    recentOn,
    view.query,
    visibleThreads,
    tabs
  )
  const visibleThreadGroups = useMemo(() => {
    const rows: ActivityTabsRow[] = [
      ...tabs.map((tab): ActivityTabsRow => ({ kind: 'tab', tab })),
      ...recent.map((item): ActivityTabsRow => ({ kind: 'recent-worktree', recent: item }))
    ]
    return mergeRowsIntoGroups(threadGroups, rows, view.groupBy, {
      pinnedWorktreeIds: pinnedIds,
      inactiveExpanded
    })
  }, [threadGroups, tabs, recent, view.groupBy, pinnedIds, inactiveExpanded])
  if (!attached) {
    return result
  }
  return {
    ...result,
    ...(tabsVisible ? { effectiveSelectedPaneKey: activePaneKey } : {}),
    visibleThreadGroups
  }
}
