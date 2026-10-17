// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentPaneThread, ThreadReadFilter } from '@/components/activity/activity-thread-types'
import {
  makeRepo,
  makeTab,
  makeWorktree
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { setActivityShowAllTabs } from './activity-tabs-setting'
import { activityTabsGroupRows } from './activity-tabs-rows'
import { useActivityTabsThreads } from './activity-tabs-threads'

function arrange(args: { attached: boolean; on: boolean; body: 'agents' | 'workspaces' }): void {
  registerPilotStore(args.attached ? useAppStore : null)
  act(() => setActivityShowAllTabs(args.on))
  useAppStore.setState({ sidebarOpen: true, sidebarBody: args.body })
}

afterEach(() => {
  act(() => setActivityShowAllTabs(false))
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
      expect(groups.flatMap(activityTabsGroupRows).map((row) => row.tab.label)).toEqual(rows)
    }
  )
})
