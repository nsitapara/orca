import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  getRepoExecutionHostId,
  getSettingsFocusedExecutionHostId
} from '../../../../../shared/execution-host'
import { getRepoHostIdentityForParts } from '../../../../../shared/repo-host-identity'
import {
  EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
  getPairedDeviceIdsByEnvironment
} from '../../../../../shared/workspace-creator-visibility'
import { resolveActivityScopeRepoIds } from '@/components/activity/activity-scope-filter'
import { resolvePaletteRepoForWorktree } from '@/lib/palette-repo-resolution'
import {
  findAmbiguousWorktreeIds,
  getPaletteOwnershipWorktreeIds
} from '@/lib/unified-tab-host-ownership'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import { useAppStore } from '@/store'
import { useActivityProjectRepoIds } from '../activity-machines/use-activity-project-scope'
import { agentTabKey, type WorktreeTabsContext } from './workspace-tab-items'

// The same host/project/origin scope Activity applies to its agent threads.
export function useWorktreeTabsContext(
  query: string,
  threads: readonly AgentPaneThread[]
): WorktreeTabsContext {
  const data = useAppStore(
    useShallow((s) => ({
      repos: s.repos,
      worktreesByRepo: s.worktreesByRepo,
      folderWorkspaces: s.folderWorkspaces,
      getKnownWorktreeById: s.getKnownWorktreeById,
      generatedTitlesEnabled: s.settings?.tabAutoGenerateTitle === true,
      defaultHostId: getSettingsFocusedExecutionHostId(s.settings),
      visibleHostIds: s.agentsVisibleHostIds,
      filterRepoIds: s.agentsFilterRepoIds,
      hideWorkspacesFromOtherDevices: s.agentsHideWorkspacesFromOtherDevices,
      hideAutomationGeneratedWorkspaces: s.agentsHideAutomationGeneratedWorkspaces,
      hideCliCreatedWorkspaces: s.agentsHideCliCreatedWorkspaces,
      // Why gated: runtime status churns, and only the other-device filter reads it.
      runtimeEnvironments: s.agentsHideWorkspacesFromOtherDevices ? s.runtimeEnvironments : null,
      runtimeStatusByEnvironmentId: s.agentsHideWorkspacesFromOtherDevices
        ? s.runtimeStatusByEnvironmentId
        : null
    }))
  )
  const filterRepoIds = useActivityProjectRepoIds(data.filterRepoIds)
  return useMemo(() => {
    const repoMap = new Map(data.repos.map((repo) => [repo.id, repo]))
    const hostRepos = new Map(
      data.repos.map((repo) => [
        getRepoHostIdentityForParts(repo.id, getRepoExecutionHostId(repo)),
        repo
      ])
    )
    return {
      getKnownWorktreeById: data.getKnownWorktreeById,
      resolveRepo: (worktree) =>
        resolvePaletteRepoForWorktree(worktree, repoMap, hostRepos) ?? null,
      ambiguous: findAmbiguousWorktreeIds(getPaletteOwnershipWorktreeIds(data)),
      scope: {
        visibleHostIds: data.visibleHostIds,
        filterRepoIds: resolveActivityScopeRepoIds(filterRepoIds, repoMap),
        defaultHostId: data.defaultHostId,
        hideWorkspacesFromOtherDevices: data.hideWorkspacesFromOtherDevices,
        pairedDeviceIdsByEnvironment:
          data.runtimeEnvironments && data.runtimeStatusByEnvironmentId
            ? getPairedDeviceIdsByEnvironment(
                data.runtimeEnvironments,
                data.runtimeStatusByEnvironmentId
              )
            : EMPTY_PAIRED_DEVICE_IDS_BY_ENVIRONMENT,
        hideAutomationGeneratedWorkspaces: data.hideAutomationGeneratedWorkspaces,
        hideCliCreatedWorkspaces: data.hideCliCreatedWorkspaces
      },
      agentTabKeys: new Set(threads.map((thread) => agentTabKey(thread.worktree, thread.tab.id))),
      query,
      generatedTitlesEnabled: data.generatedTitlesEnabled
    }
  }, [data, filterRepoIds, threads, query])
}
