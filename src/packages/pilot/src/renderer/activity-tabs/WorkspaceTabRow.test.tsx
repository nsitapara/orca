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
