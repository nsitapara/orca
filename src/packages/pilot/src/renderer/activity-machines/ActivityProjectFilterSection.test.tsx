// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { PROJECT_REPOS, attach } from './activity-machines-test-fixtures'
import { ActivityProjectFilterSection } from './ActivityProjectFilterSection'

afterEach(() => {
  cleanup()
  registerPilotStore(null)
})

// The saved filter names the Mac mini's copy; the row shown is this Mac's, so removal must match it.
it('removing a project picked through another machine’s copy clears the filter', async () => {
  attach()
  useAppStore.setState({ repos: PROJECT_REPOS, projects: [], projectHostSetups: [] })
  const setFilterRepoIds = vi.fn()
  render(
    <DropdownMenu defaultOpen>
      <DropdownMenuTrigger>Options</DropdownMenuTrigger>
      <DropdownMenuContent>
        <ActivityProjectFilterSection
          filterRepoIds={['a-mini']}
          setFilterRepoIds={setFilterRepoIds}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('menuitem', { name: /Projects/ }))
  // Why: happy-dom has no layout, so moving the pointer off the trigger would close the submenu.
  fireEvent.click(await screen.findByRole('button', { name: 'Remove a-local filter' }))
  expect(setFilterRepoIds).toHaveBeenCalledWith([])
})
