// @vitest-environment happy-dom
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import {
  makeRepo,
  makeTab,
  makeWorktree
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { setActivityShowAllTabs } from './activity-tabs-setting'
import { useActivityTabsTabStrip, useActivityTabsTitlebarController } from './activity-tabs-strips'
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

describe('tab strips while Activity lists the tabs', () => {
  it.each([
    {
      attached: true,
      on: true,
      body: 'agents',
      worktreeId: 'wt-1',
      strip: 'external',
      titlebar: false
    },
    {
      attached: true,
      on: true,
      body: 'agents',
      worktreeId: FLOATING_TERMINAL_WORKTREE_ID,
      strip: 'attached',
      titlebar: false
    },
    {
      attached: true,
      on: true,
      body: 'workspaces',
      worktreeId: 'wt-1',
      strip: 'attached',
      titlebar: true
    },
    {
      attached: true,
      on: false,
      body: 'agents',
      worktreeId: 'wt-1',
      strip: 'attached',
      titlebar: true
    },
    {
      attached: false,
      on: true,
      body: 'agents',
      worktreeId: 'wt-1',
      strip: 'attached',
      titlebar: true
    }
  ] as const)(
    'attached=$attached on=$on sidebar=$body $worktreeId → strip $strip, titlebar shown $titlebar',
    ({ attached, on, body, worktreeId, strip, titlebar }) => {
      arrange({ attached, on, body })
      expect(renderHook(() => useActivityTabsTabStrip('attached', worktreeId)).result.current).toBe(
        strip
      )
      const target = document.createElement('div')
      const controller = renderHook(() =>
        useActivityTabsTitlebarController({ titlebarTabsTarget: target })
      ).result.current
      expect(controller.titlebarTabsTarget).toBe(titlebar ? target : null)
    }
  )

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

  it.each([
    { on: true, expected: 'pane-1' },
    { on: false, expected: 'clicked' }
  ])(
    'highlights the active tab’s agent only while Activity lists tabs (on=$on)',
    ({ on, expected }) => {
      arrange({ attached: true, on, body: 'agents' })
      useAppStore.setState({
        activeWorktreeId: 'wt-1',
        activeView: 'terminal',
        activeGroupIdByWorktree: { 'wt-1': 'g' },
        groupsByWorktree: {
          'wt-1': [
            { id: 'g', worktreeId: 'wt-1', activeTabId: 'unified-1', tabOrder: ['unified-1'] }
          ]
        },
        unifiedTabsByWorktree: {
          'wt-1': [
            {
              id: 'unified-1',
              entityId: 'tab-1',
              worktreeId: 'wt-1',
              groupId: 'g',
              contentType: 'terminal',
              label: 'Claude',
              customLabel: null,
              color: null,
              sortOrder: 0,
              createdAt: 1
            }
          ]
        }
      })
      const { result } = renderHook(() =>
        useActivityTabsThreads({ allThreads: [thread], effectiveSelectedPaneKey: 'clicked' })
      )
      expect(result.current.effectiveSelectedPaneKey).toBe(expected)
    }
  )
})
