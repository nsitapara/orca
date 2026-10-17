// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makePaneKey } from '../../../../../shared/stable-pane-id'
import {
  LEAF_ID,
  makeTabWithIds,
  makeWorktreeWithId
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { useAgentPaneThreads } from '@/components/activity/use-agent-pane-threads'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { PROJECT_REPOS, attach } from './activity-machines-test-fixtures'

afterEach(() => {
  cleanup()
  registerPilotStore(null)
  vi.restoreAllMocks()
})

// An agent in the Mac mini's copy of the project, under a filter saved as this Mac's copy.
function arrangeMiniAgent(): string {
  vi.spyOn(Date, 'now').mockReturnValue(100_000)
  const worktree = makeWorktreeWithId('wt-mini', 'a-mini')
  const tab = makeTabWithIds('tab-mini', worktree.id)
  const paneKey = makePaneKey(tab.id, LEAF_ID)
  useAppStore.setState({
    agentStatusByPaneKey: {
      [paneKey]: {
        paneKey,
        state: 'working',
        prompt: 'Task',
        agentType: 'claude',
        updatedAt: 100_000,
        stateStartedAt: 99_000,
        stateHistory: []
      }
    },
    retainedAgentsByPaneKey: {},
    migrationUnsupportedByPtyId: {},
    runtimeAgentOrchestrationByPaneKey: {},
    acknowledgedAgentsByPaneKey: {},
    activityClearedAtByPaneKey: {},
    repos: PROJECT_REPOS,
    projects: [],
    projectHostSetups: [],
    worktreesByRepo: { 'a-mini': [worktree] },
    folderWorkspaces: [],
    detectedWorktreesByRepo: {},
    tabsByWorktree: { [worktree.id]: [tab] },
    unifiedTabsByWorktree: {},
    agentsVisibleHostIds: null,
    agentsFilterRepoIds: ['a-local']
  })
  return paneKey
}

it.each([
  { name: 'drops it until Pilot attaches', attached: false, kept: false },
  { name: 'keeps it once Pilot attaches', attached: true, kept: true }
])('a project filter on another machine’s copy $name', ({ attached, kept }) => {
  const paneKey = arrangeMiniAgent()
  if (attached) {
    attach()
  }
  const { result } = renderHook(() =>
    useAgentPaneThreads({ query: '', readFilter: 'all', groupBy: 'none', selectedPaneKey: null })
  )
  expect(result.current.allThreads.map((thread) => thread.paneKey)).toEqual([paneKey])
  expect(result.current.visibleThreads.map((thread) => thread.paneKey)).toEqual(
    kept ? [paneKey] : []
  )
})
