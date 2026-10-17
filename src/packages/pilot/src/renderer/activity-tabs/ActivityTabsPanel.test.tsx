// @vitest-environment happy-dom
import { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Tab } from '../../../../../shared/tab-types'
import { makeWorktree } from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { ActivityTabsPanel } from './ActivityTabsPanel'
import { setActivityShowAllTabs, useActivityShowAllTabs } from './activity-tabs-setting'
import { ShowAllTabsMenuItem } from './ShowAllTabsMenuItem'

vi.mock('./WorkspaceActions', () => ({ WorkspaceActions: () => null }))

function tab(id: string, worktreeId: string): Tab {
  return {
    id,
    entityId: id,
    worktreeId,
    groupId: `g-${worktreeId}`,
    contentType: 'terminal',
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 1
  }
}

beforeEach(() => {
  registerPilotStore(useAppStore)
  const worktrees = ['wt-a', 'wt-b', 'wt-c'].map((id) => ({
    ...makeWorktree(),
    id,
    displayName: id
  }))
  useAppStore.setState({
    activeWorktreeId: 'wt-c',
    worktreesByRepo: { 'repo-1': worktrees },
    groupsByWorktree: Object.fromEntries(
      worktrees.map((wt) => [
        wt.id,
        [{ id: `g-${wt.id}`, worktreeId: wt.id, activeTabId: null, tabOrder: [`${wt.id}-shell`] }]
      ])
    ),
    unifiedTabsByWorktree: Object.fromEntries(
      worktrees.map((wt) => [wt.id, [tab(`${wt.id}-shell`, wt.id)]])
    )
  })
})

afterEach(() => {
  cleanup()
  act(() => setActivityShowAllTabs(false))
  registerPilotStore(null)
  window.localStorage.clear()
})

function renderPanel() {
  return render(
    <TooltipProvider>
      <ActivityTabsPanel query="" />
    </TooltipProvider>
  )
}

it('lists each workspace’s tabs, the active workspace first, only while the setting is on', () => {
  expect(renderPanel().container.innerHTML).toBe('')
  cleanup()
  act(() => setActivityShowAllTabs(true))
  const view = renderPanel()
  const order = [...view.container.querySelectorAll('[data-activity-tabs-worktree]')].map((el) =>
    el.getAttribute('data-activity-tabs-worktree')
  )
  expect(order).toEqual(['wt-c', 'wt-a', 'wt-b'])
  expect(view.getByRole('button', { name: 'wt-a-shell' })).toBeTruthy()
})

it('the options menu item turns the setting on and off', () => {
  const probe = { on: false }
  function Probe(): null {
    probe.on = useActivityShowAllTabs()
    return null
  }
  const view = render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <ShowAllTabsMenuItem />
      </DropdownMenuContent>
      <Probe />
    </DropdownMenu>
  )
  const item = view.getByRole('menuitemcheckbox', { name: 'Show all tabs in Activity' })
  act(() => item.click())
  expect(probe.on).toBe(true)
  act(() => view.getByRole('menuitemcheckbox', { name: 'Show all tabs in Activity' }).click())
  expect(probe.on).toBe(false)
})
