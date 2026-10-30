// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRepo, makeWorktree } from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../../shared/constants'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import { registerPilotStore } from '../store'
import { SidebarBodyChoice } from './SidebarBodyChoice'
import { selectedCrumbs } from './SelectedBand'
import { SidebarTop } from './SidebarTop'

vi.mock('@/components/sidebar/SetupGuideSidebarEntry', () => ({
  SetupGuideSidebarEntry: () => null
}))
vi.mock('../hosts/host-poll', () => ({ useHostPoll: () => ({ reads: [] }) }))
vi.mock('../pages/running/use-capacity', () => ({
  useCapacityTotals: () => ({ running: 0, queued: 0 })
}))

const updateSettings = vi.fn(async (updates: Partial<GlobalSettings>) => {
  useAppStore.setState((s) => ({
    settings: { ...getDefaultSettings('/tmp'), ...s.settings, ...updates }
  }))
})

function top() {
  return render(
    <TooltipProvider>
      <SidebarTop activityOptionsTarget={null} onWorkspaceBoardMenuOpenChange={() => {}}>
        <span>upstream</span>
      </SidebarTop>
    </TooltipProvider>
  )
}

beforeEach(() => {
  useAppStore.setState({
    settings: getDefaultSettings('/tmp'),
    updateSettings,
    activeView: 'terminal',
    sidebarBody: 'workspaces',
    repos: [makeRepo()],
    worktreesByRepo: { 'repo-1': [makeWorktree()] },
    activeWorktreeId: null
  })
})

afterEach(() => {
  cleanup()
  registerPilotStore(null)
  updateSettings.mockClear()
})

describe('the sidebar top', () => {
  it("renders upstream's nav and header until Pilot attaches", () => {
    top()
    expect(screen.getByText('upstream')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pages' })).toBeNull()
  })

  // Why: one row of ☰, Search, options and +; the Projects title and its bell are gone.
  it('has one top row and the default pinned pages', () => {
    registerPilotStore(useAppStore)
    top()
    expect(screen.queryByText('upstream')).toBeNull()
    for (const name of ['Pages', 'Search worktrees and browser tabs', 'Add project']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
    expect(screen.queryByRole('button', { name: 'View activity' })).toBeNull()
    const pages = within(screen.getByRole('navigation', { name: 'Pages' }))
    expect(pages.getAllByRole('button').map((row) => row.textContent)).toEqual([
      'Inbox',
      'Running',
      'Automations'
    ])
  })

  it('pins a page from the ☰ menu, and the row follows', () => {
    registerPilotStore(useAppStore)
    top()
    fireEvent.click(screen.getByRole('button', { name: 'Pages' }))
    const pin = screen.getByRole('button', { name: 'Pin Tasks' })
    expect(pin.getAttribute('aria-pressed')).toBe('false')
    act(() => fireEvent.click(pin))
    expect(updateSettings).toHaveBeenCalledWith({
      pilotPinnedPages: ['inbox', 'running', 'automations', 'tasks']
    })
    expect(screen.getByRole('button', { name: 'Unpin Tasks' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    const pages = within(screen.getByRole('navigation', { name: 'Pages' }))
    expect(pages.getByRole('button', { name: 'Tasks' })).toBeTruthy()
  })

  // Why: the band names the selected worktree in full and where it sits; nothing is selected, no band.
  it.each([
    { active: null, band: false },
    { active: 'wt-1', band: true }
  ])('with $active selected the band shows: $band', ({ active, band }) => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ activeWorktreeId: active })
    top()
    const section = screen.queryByRole('region', { name: 'Selected worktree' })
    expect(section !== null).toBe(band)
    if (section) {
      expect(section.textContent).toContain('Selected·Repo')
      expect(section.textContent).toContain('feature')
    }
  })
})

describe('selected crumbs', () => {
  it.each([
    { project: 'web', parent: null, ticket: null, crumbs: ['web'] },
    { project: 'web', parent: null, ticket: 'WEB-1', crumbs: ['web', 'WEB-1'] },
    {
      project: 'web',
      parent: { ticket: 'WEB-9', name: 'web-9-parent' },
      ticket: 'WEB-10',
      crumbs: ['web', 'WEB-9', 'WEB-10']
    },
    {
      project: 'web',
      parent: { ticket: null, name: 'parent-folder' },
      ticket: null,
      crumbs: ['web', 'parent-folder']
    },
    { project: null, parent: null, ticket: null, crumbs: [] }
  ])('$project $parent $ticket → $crumbs', ({ crumbs, ...parts }) => {
    expect(selectedCrumbs(parts)).toEqual(crumbs)
  })
})

describe('Sidebar shows', () => {
  it.each([
    { from: 'workspaces', pick: 'Activity', to: 'agents' },
    { from: 'agents', pick: 'Projects', to: 'workspaces' }
  ] as const)('$from → $pick switches the body to $to', ({ from, pick, to }) => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ sidebarBody: from })
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <SidebarBodyChoice />
        </DropdownMenuContent>
      </DropdownMenu>
    )
    const current = screen.getByRole('menuitemradio', { checked: true })
    expect(current.textContent).toBe(`Sidebar shows ${from === 'agents' ? 'Activity' : 'Projects'}`)
    fireEvent.click(screen.getByRole('menuitemradio', { name: `Sidebar shows ${pick}` }))
    expect(useAppStore.getState().sidebarBody).toBe(to)
  })
})
