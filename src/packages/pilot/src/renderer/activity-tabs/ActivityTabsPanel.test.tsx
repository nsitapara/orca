// @vitest-environment happy-dom
import { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { makeRepo, makeWorktree } from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { ActivityTabsMenuItems } from './ActivityTabsMenuItems'
import { ActivityTabsPanel } from './ActivityTabsPanel'
import {
  setActivityShowAllTabs,
  setActivityShowRecentWorktrees,
  useActivityShowAllTabs,
  useActivityShowRecentWorktrees
} from './activity-tabs-setting'

beforeEach(() => {
  registerPilotStore(useAppStore)
})

afterEach(() => {
  cleanup()
  act(() => setActivityShowAllTabs(false))
  act(() => setActivityShowRecentWorktrees(false))
  registerPilotStore(null)
  window.localStorage.clear()
})

it('heads the list with the selected project and worktree only while Show all tabs is on', () => {
  useAppStore.setState({
    repos: [makeRepo()],
    worktreesByRepo: { 'repo-1': [makeWorktree()] },
    activeWorktreeId: 'wt-1'
  })
  expect(render(<ActivityTabsPanel />).container.innerHTML).toBe('')
  cleanup()
  act(() => setActivityShowAllTabs(true))
  expect(render(<ActivityTabsPanel />).container.textContent).toBe('Repofeature')
})

it.each([
  { name: 'Show all tabs in Activity', read: useActivityShowAllTabs },
  { name: 'Show recently active worktrees', read: useActivityShowRecentWorktrees }
])('the "$name" menu item turns its setting on and off', ({ name, read }) => {
  const probe = { on: false }
  function Probe(): null {
    probe.on = read()
    return null
  }
  const view = render(
    <DropdownMenu open>
      <DropdownMenuContent>
        <ActivityTabsMenuItems />
      </DropdownMenuContent>
      <Probe />
    </DropdownMenu>
  )
  act(() => view.getByRole('menuitemcheckbox', { name }).click())
  expect(probe.on).toBe(true)
  act(() => view.getByRole('menuitemcheckbox', { name }).click())
  expect(probe.on).toBe(false)
})
