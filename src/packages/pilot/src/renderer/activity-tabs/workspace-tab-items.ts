import type { ClientHostedBrowserRow } from '../../../../../shared/client-hosted-browser-rows'
import { getWorktreeExecutionHostId } from '../../../../../shared/execution-host'
import type { Repo } from '../../../../../shared/repo-types'
import type { Tab, TabGroup } from '../../../../../shared/tab-types'
import { resolveUnifiedTabLabel } from '../../../../../shared/tab-title-resolution'
import { isWorkspaceOwnedBySomeoneElse } from '../../../../../shared/workspace-creator-visibility'
import {
  isAutomationGeneratedWorkspace,
  isCliCreatedWorkspace
} from '../../../../../shared/worktree/workspace-kinds'
import type { Worktree } from '../../../../../shared/worktree/types'
import type { ActivityScopeFilter } from '@/components/activity/activity-scope-filter'
import { isActivitySearchQueryTooLarge } from '@/components/activity/activity-thread-grouping'
import { getClientHostedBrowserRowLabel } from '@/components/tab-bar/client-hosted-browser-row-label'
import {
  getPaletteWorktreeExecutionHostId,
  getPaletteWorktreeIdentity
} from '@/lib/palette-repo-resolution'
import { findDuplicateIds, isUnifiedTabOwnedByWorktree } from '@/lib/unified-tab-host-ownership'
import type { AppState } from '@/store/types'

export type WorkspaceTabItem = {
  key: string
  tab: Tab
  worktree: Worktree
  repo: Repo | null
  label: string
  clientHostedRow?: ClientHostedBrowserRow
}

export type WorktreeTabsContext = {
  getKnownWorktreeById: AppState['getKnownWorktreeById']
  resolveRepo: (worktree: Worktree) => Repo | null
  /** Worktree ids that exist on more than one host. */
  ambiguous: ReadonlySet<string>
  scope: ActivityScopeFilter
  /** agentTabKey() of every tab Activity already lists as an agent. */
  agentTabKeys: ReadonlySet<string>
  query: string
  generatedTitlesEnabled: boolean
}

export function agentTabKey(worktree: Worktree, tabId: string): string {
  return JSON.stringify([getPaletteWorktreeIdentity(worktree), tabId])
}

// Mirrors threadMatchesActivityScope, which takes a whole agent thread.
export function workspaceMatchesActivityScope(
  target: { worktree: Worktree; repo: Repo | null },
  scope: ActivityScopeFilter
): boolean {
  if (
    scope.visibleHostIds &&
    !scope.visibleHostIds.includes(
      getWorktreeExecutionHostId(target.worktree, target.repo ?? undefined, scope.defaultHostId)
    )
  ) {
    return false
  }
  if (
    scope.filterRepoIds.length > 0 &&
    (!target.repo || !scope.filterRepoIds.includes(target.repo.id))
  ) {
    return false
  }
  if (scope.hideAutomationGeneratedWorkspaces && isAutomationGeneratedWorkspace(target.worktree)) {
    return false
  }
  if (scope.hideCliCreatedWorkspaces && isCliCreatedWorkspace(target.worktree)) {
    return false
  }
  return !(
    scope.hideWorkspacesFromOtherDevices &&
    isWorkspaceOwnedBySomeoneElse(target.worktree, scope.pairedDeviceIdsByEnvironment)
  )
}

// How Activity orders worktrees by name, ignoring case: one collator for every sort.
export const compareWorktreeNames = new Intl.Collator(undefined, { sensitivity: 'base' }).compare

export function matchesQuery(search: string, parts: readonly string[]): boolean {
  return !search || parts.join(' ').toLowerCase().includes(search)
}

function unifiedTabItems(
  worktreeId: string,
  tabs: readonly Tab[],
  groups: readonly TabGroup[],
  ctx: WorktreeTabsContext,
  search: string
): WorkspaceTabItem[] {
  const duplicates = findDuplicateIds(tabs)
  const order = new Map(groups.flatMap((group) => group.tabOrder).map((id, i) => [id, i]))
  const items: WorkspaceTabItem[] = []
  for (const tab of [...tabs].sort(
    (a, b) => (order.get(a.id) ?? a.sortOrder) - (order.get(b.id) ?? b.sortOrder)
  )) {
    if (duplicates.has(tab.id) || !groups.some((group) => group.id === tab.groupId)) {
      continue
    }
    if (!tab.executionHostId && ctx.ambiguous.has(worktreeId)) {
      continue
    }
    const worktree = ctx.getKnownWorktreeById(worktreeId, tab.executionHostId)
    if (!worktree || !isUnifiedTabOwnedByWorktree(tab, worktree, ctx.ambiguous)) {
      continue
    }
    const backingId = tab.contentType === 'agent-session' ? tab.id : tab.entityId
    if (
      (tab.contentType === 'terminal' || tab.contentType === 'agent-session') &&
      ctx.agentTabKeys.has(agentTabKey(worktree, backingId))
    ) {
      continue
    }
    const repo = ctx.resolveRepo(worktree)
    if (!workspaceMatchesActivityScope({ worktree, repo }, ctx.scope)) {
      continue
    }
    const label = resolveUnifiedTabLabel(tab, ctx.generatedTitlesEnabled, tab.label)
    const haystack = [label, tab.contentType, worktree.displayName, worktree.branch]
    if (!matchesQuery(search, [...haystack, repo?.displayName ?? ''])) {
      continue
    }
    items.push({
      key: JSON.stringify([
        tab.executionHostId ?? getPaletteWorktreeExecutionHostId(worktree),
        worktreeId,
        tab.id
      ]),
      tab,
      worktree,
      repo,
      label
    })
  }
  return items
}

// Native pages of remote workspaces aren't unified tabs; list them as browser rows.
function clientHostedItems(
  worktreeId: string,
  rows: readonly ClientHostedBrowserRow[],
  groups: readonly TabGroup[],
  ctx: WorktreeTabsContext,
  search: string
): WorkspaceTabItem[] {
  const worktree = ctx.ambiguous.has(worktreeId) ? undefined : ctx.getKnownWorktreeById(worktreeId)
  const group = groups[0]
  if (!worktree || !group) {
    return []
  }
  const repo = ctx.resolveRepo(worktree)
  if (!workspaceMatchesActivityScope({ worktree, repo }, ctx.scope)) {
    return []
  }
  return rows.flatMap((row) => {
    const label = getClientHostedBrowserRowLabel(row)
    if (
      !matchesQuery(search, [
        label,
        row.url,
        'browser',
        worktree.displayName,
        repo?.displayName ?? ''
      ])
    ) {
      return []
    }
    return [
      {
        key: `client-browser:${row.worktreeId}:${row.browserPageId}`,
        worktree,
        repo,
        label,
        clientHostedRow: row,
        tab: {
          id: row.browserPageId,
          entityId: row.browserPageId,
          groupId: group.id,
          worktreeId: row.worktreeId,
          contentType: 'browser',
          label,
          customLabel: null,
          color: null,
          sortOrder: 0,
          createdAt: 0
        }
      }
    ]
  })
}

export function buildWorktreeTabItems(
  worktreeId: string,
  input: {
    tabs: readonly Tab[]
    groups: readonly TabGroup[]
    clientRows: readonly ClientHostedBrowserRow[]
  },
  ctx: WorktreeTabsContext
): WorkspaceTabItem[] {
  if (isActivitySearchQueryTooLarge(ctx.query)) {
    return []
  }
  const search = ctx.query.trim().toLowerCase()
  return [
    ...unifiedTabItems(worktreeId, input.tabs, input.groups, ctx, search),
    ...clientHostedItems(worktreeId, input.clientRows, input.groups, ctx, search)
  ]
}
