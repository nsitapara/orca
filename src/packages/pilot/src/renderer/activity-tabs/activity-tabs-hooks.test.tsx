// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentPaneThread, ThreadReadFilter } from '@/components/activity/activity-thread-types'
import { buildActivityThreadGroups } from '@/components/activity/activity-thread-grouping'
import {
  makeRepo,
  makeTab,
  makeWorktree,
  makeWorktreeWithId
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { setActivityShowAllTabs, setActivityShowRecentWorktrees } from './activity-tabs-setting'
import { activityTabsGroupRows, type ActivityTabsVirtualItem } from './activity-tabs-rows'
import { useActivityTabsThreads } from './activity-tabs-threads'

function arrange(args: { attached: boolean; on: boolean; body: 'agents' | 'workspaces' }): void {
  registerPilotStore(args.attached ? useAppStore : null)
  act(() => setActivityShowAllTabs(args.on))
  useAppStore.setState({ sidebarOpen: true, sidebarBody: args.body })
}

afterEach(() => {
  act(() => setActivityShowAllTabs(false))
  act(() => setActivityShowRecentWorktrees(false))
  registerPilotStore(null)
  window.localStorage.clear()
})

describe('the Show all tabs setting', () => {
  it('opens Activity and remembers the choice when turned on', () => {
    useAppStore.setState({ sidebarOpen: false, sidebarBody: 'workspaces' })
    act(() => setActivityShowAllTabs(true))
    expect(useAppStore.getState()).toMatchObject({ sidebarOpen: true, sidebarBody: 'agents' })
    expect(window.localStorage.getItem('pilot.activity.show-all-tabs')).toBe('true')
  })
})

function rowLabel({ row }: ActivityTabsVirtualItem): string {
  return row.kind === 'tab' ? row.tab.label : `recent:${row.recent.worktree.id}`
}

describe('useActivityTabsThreads', () => {
  const thread: AgentPaneThread = {
    paneKey: 'pane-1',
    tab: makeTab(),
    worktree: makeWorktree(),
    repo: makeRepo(),
    currentAgentState: null,
    currentAgentEntry: null,
    latestEvent: null,
    latestTimestamp: 1,
    agentType: 'claude',
    unread: false,
    paneTitle: 'Claude',
    responsePreview: '',
    events: []
  }

  function unifiedTab(id: string, entityId: string, label: string) {
    return {
      id,
      entityId,
      worktreeId: 'wt-1',
      groupId: 'g',
      contentType: 'terminal' as const,
      label,
      customLabel: null,
      color: null,
      sortOrder: 0,
      createdAt: 1
    }
  }

  // wt-1 holds the agent's terminal (unified-1) and a plain shell (unified-2); unified-1 is active.
  function arrangeTabs(on: boolean): void {
    arrange({ attached: true, on, body: 'agents' })
    useAppStore.setState({
      repos: [makeRepo()],
      worktreesByRepo: { 'repo-1': [makeWorktree()] },
      activeWorktreeId: 'wt-1',
      activeView: 'terminal',
      activeGroupIdByWorktree: { 'wt-1': 'g' },
      groupsByWorktree: {
        'wt-1': [
          {
            id: 'g',
            worktreeId: 'wt-1',
            activeTabId: 'unified-1',
            tabOrder: ['unified-1', 'unified-2']
          }
        ]
      },
      unifiedTabsByWorktree: {
        'wt-1': [
          unifiedTab('unified-1', 'tab-1', 'Claude'),
          unifiedTab('unified-2', 'tab-2', 'Shell')
        ]
      }
    })
  }

  function renderThreads(readFilter: ThreadReadFilter = 'all') {
    return renderHook(() =>
      useActivityTabsThreads(
        { allThreads: [thread], effectiveSelectedPaneKey: 'clicked', visibleThreadGroups: [] },
        { query: '', readFilter, groupBy: 'status' }
      )
    ).result.current
  }

  it.each([
    { on: true, expected: 'pane-1' },
    { on: false, expected: 'clicked' }
  ])(
    'highlights the active tab’s agent only while Activity lists tabs (on=$on)',
    ({ on, expected }) => {
      arrangeTabs(on)
      expect(renderThreads().effectiveSelectedPaneKey).toBe(expected)
    }
  )

  it.each([
    { on: true, readFilter: 'all', rows: ['Shell'] },
    { on: true, readFilter: 'unread', rows: [] },
    { on: false, readFilter: 'all', rows: [] }
  ] as const)(
    'lists tabs that aren’t agents only while on and not unread-only (on=$on $readFilter)',
    ({ on, readFilter, rows }) => {
      arrangeTabs(on)
      const groups = renderThreads(readFilter).visibleThreadGroups
      expect(groups.flatMap(activityTabsGroupRows).map(rowLabel)).toEqual(rows)
    }
  )
  // wt-1 holds the agent; wt-2 was active a minute ago; wt-3 four days ago; wt-4 is pinned, from long ago.
  it.each([
    { on: true, rows: ['recent:wt-4', 'recent:wt-2'] },
    { on: false, rows: ['recent:wt-4'] }
  ])('adds pinned worktrees, and recent ones only while on (on=$on)', ({ on, rows }) => {
    arrange({ attached: true, on: false, body: 'agents' })
    act(() => setActivityShowRecentWorktrees(on))
    const now = Date.now()
    useAppStore.setState({
      repos: [makeRepo()],
      folderWorkspaces: [],
      unifiedTabsByWorktree: {},
      worktreesByRepo: {
        'repo-1': [
          { ...makeWorktree(), lastActivityAt: now },
          { ...makeWorktreeWithId('wt-2'), lastActivityAt: now - 60_000 },
          { ...makeWorktreeWithId('wt-3'), lastActivityAt: now - 4 * 24 * 60 * 60 * 1000 },
          { ...makeWorktreeWithId('wt-4'), lastActivityAt: 1, isPinned: true }
        ]
      }
    })
    const groups = renderHook(() =>
      useActivityTabsThreads(
        {
          allThreads: [thread],
          effectiveSelectedPaneKey: null,
          visibleThreadGroups: buildActivityThreadGroups([thread], 'worktree')
        },
        { query: '', readFilter: 'all', groupBy: 'worktree' }
      )
    ).result.current.visibleThreadGroups
    expect(groups.flatMap(activityTabsGroupRows).map(rowLabel)).toEqual(rows)
  })

  // The active workspace (wt-1, "feature") sorts after "alpha" (wt-2): selecting it moves nothing.
  it('lists open tabs by workspace name, not with the active workspace first', () => {
    arrange({ attached: true, on: true, body: 'agents' })
    const tabIn = (worktreeId: string, id: string) => ({
      ...unifiedTab(id, `${id}-entity`, id),
      worktreeId
    })
    const group = (worktreeId: string, tabId: string) => [
      { id: `g-${worktreeId}`, worktreeId, activeTabId: tabId, tabOrder: [tabId] }
    ]
    useAppStore.setState({
      repos: [makeRepo()],
      worktreesByRepo: {
        'repo-1': [makeWorktree(), makeWorktreeWithId('wt-2', 'repo-1', 'alpha')]
      },
      activeWorktreeId: 'wt-1',
      groupsByWorktree: {
        'wt-1': group('wt-1', 'feature-tab'),
        'wt-2': group('wt-2', 'alpha-tab')
      },
      unifiedTabsByWorktree: {
        'wt-1': [{ ...tabIn('wt-1', 'feature-tab'), groupId: 'g-wt-1' }],
        'wt-2': [{ ...tabIn('wt-2', 'alpha-tab'), groupId: 'g-wt-2' }]
      }
    })
    const groups = renderThreads().visibleThreadGroups
    expect(groups.flatMap(activityTabsGroupRows).map(rowLabel)).toEqual([
      'alpha-tab',
      'feature-tab'
    ])
  })
})
