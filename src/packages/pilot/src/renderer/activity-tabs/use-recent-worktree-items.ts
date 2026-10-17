import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { folderWorkspaceToWorktree } from '../../../../../shared/folder-workspace-worktree'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import { useNow } from '@/hooks/use-now'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  buildRecentWorktreeItems,
  worktreeRowKey,
  type RecentWorktreeItem
} from './recent-worktree-items'
import { useWorktreeTabsContext } from './use-worktree-tabs-context'
import type { WorkspaceTabItem } from './workspace-tab-items'

const NO_ITEMS: readonly RecentWorktreeItem[] = []
const NO_THREADS: readonly AgentPaneThread[] = []
type Sources = Pick<AppState, 'worktreesByRepo' | 'folderWorkspaces' | 'unifiedTabsByWorktree'>
const NO_SOURCES: Sources = { worktreesByRepo: {}, folderWorkspaces: [], unifiedTabsByWorktree: {} }
const MINUTE_MS = 60_000

const NO_IDS: readonly string[] = []

function allWorktrees(sources: Pick<Sources, 'worktreesByRepo' | 'folderWorkspaces'>) {
  return [
    ...Object.values(sources.worktreesByRepo).flat(),
    ...sources.folderWorkspaces.map(folderWorkspaceToWorktree)
  ]
}

/** The ids of pinned worktrees, whose groups lead Activity's worktree grouping. Empty while `enabled` is false. */
export function usePinnedWorktreeIds(enabled: boolean): readonly string[] {
  return useAppStore(
    useShallow((s) =>
      enabled
        ? allWorktrees(s)
            .filter((worktree) => worktree.isPinned)
            .map((worktree) => worktree.id)
        : NO_IDS
    )
  )
}

/**
 * Pinned worktrees, and with `includeRecent` recently active ones, that have no agent or tab row in
 * Activity. Empty while `enabled` is false.
 */
export function useRecentWorktreeItems(
  enabled: boolean,
  includeRecent: boolean,
  query: string,
  threads: readonly AgentPaneThread[],
  tabs: readonly WorkspaceTabItem[]
): readonly RecentWorktreeItem[] {
  const ctx = useWorktreeTabsContext(query, enabled ? threads : NO_THREADS)
  const now = useNow(MINUTE_MS, enabled && includeRecent)
  const sources = useAppStore(
    useShallow((s): Sources =>
      enabled
        ? {
            worktreesByRepo: s.worktreesByRepo,
            folderWorkspaces: s.folderWorkspaces,
            unifiedTabsByWorktree: s.unifiedTabsByWorktree
          }
        : NO_SOURCES
    )
  )
  return useMemo(() => {
    if (!enabled) {
      return NO_ITEMS
    }
    const listed = new Set([
      ...threads.map((thread) => worktreeRowKey(thread.worktree)),
      ...tabs.map((tab) => worktreeRowKey(tab.worktree))
    ])
    return buildRecentWorktreeItems({
      worktrees: allWorktrees(sources),
      includeRecent,
      listed,
      openTabCount: (id) => sources.unifiedTabsByWorktree[id]?.length ?? 0,
      now,
      ctx
    })
  }, [enabled, includeRecent, threads, tabs, sources, now, ctx])
}
