import { useShallow } from 'zustand/react/shallow'
import type { ClientHostedBrowserRow } from '../../../../../shared/client-hosted-browser-rows'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import type { Tab, TabGroup } from '../../../../../shared/tab-types'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import {
  getClientHostedBrowserRows,
  useClientHostedBrowserRows
} from '@/lib/pane-manager/client-hosted-browser-row-state'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { useWorktreeTabsContext } from './use-worktree-tabs-context'
import {
  buildWorktreeTabItems,
  type WorkspaceTabItem,
  type WorktreeTabsContext
} from './workspace-tab-items'

const NO_ITEMS: readonly WorkspaceTabItem[] = []
const NO_THREADS: readonly AgentPaneThread[] = []
const NO_TABS: readonly Tab[] = []
const NO_GROUPS: readonly TabGroup[] = []
type TabMaps = Pick<AppState, 'unifiedTabsByWorktree' | 'groupsByWorktree'>
const NO_MAPS: TabMaps = { unifiedTabsByWorktree: {}, groupsByWorktree: {} }

type CacheEntry = {
  tabs: readonly Tab[]
  groups: readonly TabGroup[]
  rows: readonly ClientHostedBrowserRow[]
  items: WorkspaceTabItem[]
}

// Why: Activity re-lays out its list when its rows change identity, so an unchanged workspace
// keeps its item objects across renders.
const itemsByContext = new WeakMap<WorktreeTabsContext, Map<string, CacheEntry>>()

function worktreeItems(
  worktreeId: string,
  input: {
    tabs: readonly Tab[]
    groups: readonly TabGroup[]
    rows: readonly ClientHostedBrowserRow[]
  },
  ctx: WorktreeTabsContext
): WorkspaceTabItem[] {
  let cache = itemsByContext.get(ctx)
  if (!cache) {
    cache = new Map()
    itemsByContext.set(ctx, cache)
  }
  const hit = cache.get(worktreeId)
  if (hit && hit.tabs === input.tabs && hit.groups === input.groups && hit.rows === input.rows) {
    return hit.items
  }
  const items = buildWorktreeTabItems(
    worktreeId,
    { tabs: input.tabs, groups: input.groups, clientRows: input.rows },
    ctx
  )
  cache.set(worktreeId, { ...input, items })
  return items
}

function compareWorktrees(activeId: string | null, nameOf: (id: string) => string) {
  return (a: string, b: string): number => {
    if (a === activeId || b === activeId) {
      return a === activeId ? -1 : 1
    }
    return nameOf(a).localeCompare(nameOf(b))
  }
}

/**
 * Every workspace's tabs that Activity doesn't already list as agents: the active workspace
 * first, then by name, each in tab order. Empty while `enabled` is false.
 */
export function useOpenTabItems(
  enabled: boolean,
  query: string,
  agentThreads: readonly AgentPaneThread[]
): readonly WorkspaceTabItem[] {
  const ctx = useWorktreeTabsContext(query, enabled ? agentThreads : NO_THREADS)
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const { unifiedTabsByWorktree, groupsByWorktree } = useAppStore(
    useShallow((s): TabMaps =>
      enabled
        ? { unifiedTabsByWorktree: s.unifiedTabsByWorktree, groupsByWorktree: s.groupsByWorktree }
        : NO_MAPS
    )
  )
  // Why: the row store bumps one version for every workspace, so this re-renders on any of them.
  useClientHostedBrowserRows(activeWorktreeId ?? '')
  const stable = useShallow((items: readonly WorkspaceTabItem[]) => items)
  if (!enabled) {
    return NO_ITEMS
  }
  const nameOf = (id: string) => ctx.getKnownWorktreeById(id)?.displayName ?? id
  return stable(
    Object.keys(groupsByWorktree)
      .filter((id) => id !== FLOATING_TERMINAL_WORKTREE_ID)
      .sort(compareWorktrees(activeWorktreeId, nameOf))
      .flatMap((id) =>
        worktreeItems(
          id,
          {
            tabs: unifiedTabsByWorktree[id] ?? NO_TABS,
            groups: groupsByWorktree[id] ?? NO_GROUPS,
            rows: getClientHostedBrowserRows(id)
          },
          ctx
        )
      )
  )
}
