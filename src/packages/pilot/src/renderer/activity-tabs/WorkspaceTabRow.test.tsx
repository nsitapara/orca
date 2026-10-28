// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { useAppStore } from '@/store'
import { TooltipProvider } from '@/components/ui/tooltip'
import { WorkspaceTabRow } from './WorkspaceTabRow'
import { makeWorktree } from '@/components/activity/ActivityPrototypePage-test-fixtures'
import {
  applyClientHostedBrowserRows,
  getClientHostedBrowserRowSelection,
  hydrateClientHostedBrowserRows
} from '@/lib/pane-manager/client-hosted-browser-row-state'
import type { ClientHostedBrowserRow } from '../../../../../shared/client-hosted-browser-rows'

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: () => {
    useAppStore.setState({
      groupsByWorktree: {
        'wt-1': [
          {
            id: 'g',
            worktreeId: 'wt-1',
            activeTabId: 'seeded-terminal',
            tabOrder: ['seeded-terminal']
          }
        ]
      }
    })
    return true
  }
}))
afterEach(() => {
  cleanup()
  hydrateClientHostedBrowserRows([])
})

it('selects the hosted browser over the tab created while activating an empty workspace', () => {
  useAppStore.setState({
    activeWorktreeId: 'wt-1',
    activeView: 'terminal',
    groupsByWorktree: {
      'wt-1': [{ id: 'g', worktreeId: 'wt-1', activeTabId: null, tabOrder: [] }]
    },
    activeGroupIdByWorktree: { 'wt-1': 'g' }
  })
  const row: ClientHostedBrowserRow = {
    worktreeId: 'wt-1',
    browserPageId: 'page',
    title: 'Docs',
    url: 'https://example.com',
    loading: false,
    browserHostClientId: 'device',
    hostDeviceName: 'Laptop',
    hostAbsent: false
  }
  applyClientHostedBrowserRows({ worktreeId: 'wt-1', rows: [row] })
  const view = render(
    <TooltipProvider>
      <WorkspaceTabRow
        item={{
          key: 'page',
          label: 'Docs',
          worktree: makeWorktree(),
          repo: null,
          clientHostedRow: row,
          tab: {
            id: 'page',
            entityId: 'page',
            groupId: 'g',
            worktreeId: 'wt-1',
            contentType: 'browser',
            label: 'Docs',
            customLabel: null,
            color: null,
            sortOrder: 0,
            createdAt: 0
          }
        }}
      />
    </TooltipProvider>
  )
  fireEvent.click(view.getByRole('button', { name: 'Docs' }))
  expect(getClientHostedBrowserRowSelection()?.groupActiveTabIdAtSelection).toBe('seeded-terminal')
})

// Why: the row names the agent its tab-bar tab names; a title can show Claude before or without launch intent.
// An automation's tab (named so at launch) shows the automation icon where its agent's was; its tooltip still names the agent.
it.each([
  { title: '✳ Claude Code', customTitle: null, launchAgent: undefined, expected: 'Claude' },
  { title: 'Terminal 1', customTitle: null, launchAgent: 'codex' as const, expected: 'Codex' },
  { title: 'zsh', customTitle: null, launchAgent: undefined, expected: null },
  {
    title: '✳ Claude Code',
    customTitle: '[Automation] Fix CI · !1561',
    launchAgent: undefined,
    expected: 'Automation run (Claude)'
  },
  // Its agent exited: the plain terminal icon, as the tab bar shows.
  {
    title: 'zsh',
    customTitle: '[Automation] Fix CI · !1561',
    launchAgent: undefined,
    expected: null
  }
])(
  'a terminal titled "$title" ($customTitle) with launch agent $launchAgent shows $expected',
  ({ title, customTitle, launchAgent, expected }) => {
    useAppStore.setState({
      tabsByWorktree: {
        'wt-1': [
          {
            id: 'term-1',
            ptyId: null,
            worktreeId: 'wt-1',
            title,
            customTitle,
            color: null,
            sortOrder: 0,
            createdAt: 0,
            ...(launchAgent ? { launchAgent } : {})
          }
        ]
      }
    })
    const view = render(
      <TooltipProvider>
        <WorkspaceTabRow
          item={{
            key: 'tab-1',
            label: title,
            worktree: makeWorktree(),
            repo: null,
            tab: {
              id: 'tab-1',
              entityId: 'term-1',
              groupId: 'g',
              worktreeId: 'wt-1',
              contentType: 'terminal',
              label: title,
              customLabel: null,
              color: null,
              sortOrder: 0,
              createdAt: 0
            }
          }}
        />
      </TooltipProvider>
    )
    expect(
      view.queryByTitle(/^(Claude|Codex|Automation run.*)$/)?.getAttribute('title') ?? null
    ).toBe(expected)
  }
)
