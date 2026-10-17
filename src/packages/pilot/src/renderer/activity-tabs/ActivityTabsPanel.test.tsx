// @vitest-environment happy-dom
import { act } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { ActivityTabsPanel } from './ActivityTabsPanel'
import { setActivityShowAllTabs, useActivityShowAllTabs } from './activity-tabs-setting'
import { ShowAllTabsMenuItem } from './ShowAllTabsMenuItem'

vi.mock('./WorkspaceActions', () => ({ WorkspaceActions: () => <div>workspace actions</div> }))

beforeEach(() => {
  registerPilotStore(useAppStore)
})

afterEach(() => {
  cleanup()
  act(() => setActivityShowAllTabs(false))
  registerPilotStore(null)
  window.localStorage.clear()
})

it('shows the workspace actions only while the setting is on', () => {
  expect(render(<ActivityTabsPanel />).container.innerHTML).toBe('')
  cleanup()
  act(() => setActivityShowAllTabs(true))
  expect(render(<ActivityTabsPanel />).getByText('workspace actions')).toBeTruthy()
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
