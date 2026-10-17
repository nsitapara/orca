import type React from 'react'
import { vi } from 'vitest'
import {
  getLocalExecutionHostLabel,
  type ExecutionHostId
} from '../../../../../shared/execution-host'
import { createGlobalSettingsFixture } from '../../../../../shared/global-settings-test-fixture'
import type { Repo } from '../../../../../shared/repo-types'
import type { Worktree } from '../../../../../shared/worktree/types'
import type { ActivityThreadListPane } from '@/components/activity/activity-thread-list-pane'
import type {
  ActivityThreadGroup,
  AgentPaneThread
} from '@/components/activity/activity-thread-types'
import {
  makeRepo,
  makeTab,
  makeWorktree
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { useAppStore } from '@/store'
import { withActivityTabsCount, type ActivityTabsRow } from '../activity-tabs/activity-tabs-rows'
import { registerPilotStore } from '../store'

export const MINI = 'runtime:mini' as const
export const LOCAL_LABEL = getLocalExecutionHostLabel()

/** Detach in afterEach with registerPilotStore(null). */
export function attach(): void {
  registerPilotStore(useAppStore)
}

function projectRepo(id: string, hostId: ExecutionHostId): Repo {
  return { ...makeRepo(), id, path: `/${id}`, displayName: id, executionHostId: hostId }
}

/** This Mac plus a runtime named "Mac mini" that a project lives on. */
export function arrangeMachines(): void {
  useAppStore.setState({
    repos: [projectRepo('repo-mini', MINI)],
    sshTargetLabels: new Map(),
    runtimeEnvironments: [],
    settings: createGlobalSettingsFixture({
      hostSettingOverrides: { 'runtime:mini': { displayLabel: 'Mac mini' } }
    })
  })
}

// A hostless worktree whose repo names no host sits on the focused host: this Mac.
function machineWorktree(id: string, hostId: ExecutionHostId | undefined): Worktree {
  const worktree = { ...makeWorktree(), id, path: `/repo/${id}` }
  return hostId ? { ...worktree, hostId } : worktree
}

export function machineThread(paneKey: string, hostId?: ExecutionHostId): AgentPaneThread {
  return {
    paneKey,
    paneTitle: 'Claude',
    worktree: machineWorktree(`wt-${paneKey}`, hostId),
    repo: makeRepo(),
    tab: { ...makeTab(), id: `tab-${paneKey}`, ptyId: `pty-${paneKey}` },
    agentType: 'claude',
    currentAgentState: null,
    currentAgentEntry: null,
    responsePreview: '',
    latestTimestamp: 1,
    latestEvent: null,
    events: [],
    unread: false
  }
}

export function machineGroups(...threads: AgentPaneThread[]): ActivityThreadGroup[] {
  return [{ key: 'all', label: '', threads }]
}

export function pilotRow(
  kind: 'tab' | 'recent-worktree',
  hostId: ExecutionHostId
): ActivityTabsRow {
  const worktree = machineWorktree(`wt-${kind}`, hostId)
  const repo = makeRepo()
  if (kind === 'recent-worktree') {
    return {
      kind,
      recent: { key: `recent-${worktree.id}`, worktree, repo, pinned: false }
    }
  }
  const tab = {
    id: 'shell',
    entityId: 'shell',
    worktreeId: worktree.id,
    groupId: 'g',
    contentType: 'terminal' as const,
    label: 'Shell',
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
  return { kind, tab: { key: `tab-${worktree.id}`, tab, worktree, repo, label: 'Shell' } }
}

export function listPaneProps(
  groups: ActivityThreadGroup[]
): React.ComponentProps<typeof ActivityThreadListPane> {
  const threadCount = groups.reduce((count, group) => count + group.threads.length, 0)
  return {
    activityFilterInputRef: { current: null },
    query: '',
    onQueryChange: vi.fn(),
    groupBy: 'none',
    onGroupByChange: vi.fn(),
    readFilter: 'all',
    onReadFilterChange: vi.fn(),
    compactMode: false,
    hasUnreadThreads: false,
    onCompactModeChange: vi.fn(),
    visibleThreadGroups: groups,
    visibleThreadCount: withActivityTabsCount(threadCount, groups),
    selectedPaneKey: null,
    onSelectThread: vi.fn(),
    onJumpToWorkspace: vi.fn(),
    onMarkThreadRead: vi.fn(),
    onMarkThreadUnread: vi.fn(),
    onMarkThreadsRead: vi.fn(),
    onMarkThreadsUnread: vi.fn(),
    canJumpToWorkspace: vi.fn(() => true)
  }
}
