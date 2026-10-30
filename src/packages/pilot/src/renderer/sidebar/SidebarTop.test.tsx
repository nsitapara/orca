// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeRepo,
  makeWorktree,
  makeWorktreeWithId
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { DropdownMenu, DropdownMenuContent } from '@/components/ui/dropdown-menu'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { getDefaultSettings } from '../../../../../shared/constants'
import { folderWorkspaceToWorktree } from '../../../../../shared/folder-workspace-worktree'
import type { FolderWorkspace } from '../../../../../shared/folder-workspace-types'
import type { GlobalSettings } from '../../../../../shared/global-settings-types'
import type { ProjectGroup } from '../../../../../shared/project-group-types'
import type * as LinearBranchIssue from '../activity-card/linear-branch-issue'
import { registerPilotStore } from '../store'
import { PinnedPagesSettings } from './PinnedPagesSettings'
import { SidebarBodyChoice, SidebarBodyMenuSection } from './SidebarBodyChoice'
import { currentPath } from './CurrentBand'
import { SidebarTop } from './SidebarTop'

vi.mock('@/components/sidebar/SetupGuideSidebarEntry', () => ({
  SetupGuideSidebarEntry: () => null
}))
vi.mock('../hosts/host-poll', () => ({ useHostPoll: () => ({ reads: [] }) }))
vi.mock('../pages/running/use-capacity', () => ({
  useCapacityTotals: () => ({ running: 0, queued: 0 })
}))
// Linear confirms every ticket a branch is named for.
vi.mock('../activity-card/linear-branch-issue', async (importOriginal) => {
  const actual = await importOriginal<typeof LinearBranchIssue>()
  return {
    ...actual,
    useBranchLinearIssue: (branch: string | null | undefined) => {
      const identifier = branch ? actual.linearIdOfBranch(branch) : null
      return identifier ? { identifier } : null
    }
  }
})
const agents = vi.hoisted(() => {
  const state: { rows: unknown[]; focused: string | null } = { rows: [], focused: null }
  return state
})
vi.mock('@/components/sidebar/useWorktreeAgentRows', () => ({
  useWorktreeAgentRows: () => agents.rows
}))
vi.mock('@/components/sidebar/focused-agent-row-highlight', () => ({
  useFocusedAgentPaneKey: () => agents.focused
}))
const reveal = vi.hoisted(() => vi.fn())
vi.mock('@/lib/scroll-to-current-workspace-status', () => ({
  requestScrollToCurrentWorkspaceReveal: reveal
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
  reveal.mockClear()
  agents.rows = []
  agents.focused = null
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
})

const PARENT = { ...makeWorktreeWithId('wt-1', 'repo-1', 'web-9-parent'), branch: 'web-9-parent' }
const LONG_NAME = 'web-10-a-sub-issue-whose-name-is-long-enough-to-wrap'
const CHILD = { ...makeWorktreeWithId('wt-kid', 'repo-1', LONG_NAME), branch: LONG_NAME }
const FOLDER: FolderWorkspace = {
  id: 'fw-1',
  projectGroupId: 'group-1',
  name: 'notes',
  folderPath: '/notes',
  linkedTask: null,
  comment: '',
  isArchived: false,
  isUnread: false,
  isPinned: false,
  sortOrder: 0,
  lastActivityAt: 1,
  createdAt: 1,
  updatedAt: 1
}
const FOLDER_ID = folderWorkspaceToWorktree(FOLDER).id
const GROUP: ProjectGroup = {
  id: 'group-1',
  name: 'Notes',
  parentPath: null,
  parentGroupId: null,
  createdFrom: 'manual',
  tabOrder: 0,
  isCollapsed: false,
  color: null,
  createdAt: 1,
  updatedAt: 1
}
const OPEN_ROW = {
  paneKey: 'tab-1:leaf-1',
  tab: { id: 'tab-1', worktreeId: 'wt-1', title: 'claude' },
  agentType: 'claude',
  rowSource: 'live',
  state: 'working',
  startedAt: 1,
  entry: {
    prompt: 'Fix the flaky login test',
    state: 'working',
    paneKey: 'tab-1:leaf-1',
    updatedAt: 1,
    stateStartedAt: 1,
    stateHistory: [],
    worktreeId: 'wt-1'
  }
}

function band(activeWorktreeId: string | null) {
  registerPilotStore(useAppStore)
  useAppStore.setState({
    activeWorktreeId,
    worktreesByRepo: {
      'repo-1': [
        { ...PARENT, instanceId: 'i-parent' },
        { ...CHILD, instanceId: 'i-kid' }
      ]
    },
    folderWorkspaces: [FOLDER],
    projectGroups: [GROUP],
    worktreeLineageById: {
      'wt-kid': {
        worktreeId: 'wt-kid',
        worktreeInstanceId: 'i-kid',
        parentWorktreeId: 'wt-1',
        parentWorktreeInstanceId: 'i-parent',
        origin: 'manual',
        capture: { source: 'manual-action', confidence: 'explicit' },
        createdAt: 1
      }
    }
  })
  top()
  const section = screen.queryByRole('region', { name: 'Current worktree' })
  return section ? [...section.children].map((line) => line.textContent) : null
}

describe('the Current header', () => {
  it('is absent with nothing selected', () => {
    expect(band(null)).toBeNull()
  })

  // Why: line 1 is where the worktree sits (its parent's ticket only for a sub-issue, never a folder's),
  // line 2 its whole name, line 3 its open session.
  it.each([
    { name: 'a root worktree', active: 'wt-1', lines: ['Current· Repo', 'web-9-parent'] },
    { name: 'a sub-issue', active: 'wt-kid', lines: ['Current· Repo › WEB-9', LONG_NAME] },
    { name: 'a folder workspace', active: FOLDER_ID, lines: ['Current· Notes', 'notes'] }
  ])('$name', ({ active, lines }) => {
    expect(band(active)).toEqual([...lines, 'No session open in this worktree'])
  })

  it("shows the worktree's open session; clicking it locates the worktree", () => {
    agents.rows = [OPEN_ROW]
    agents.focused = OPEN_ROW.paneKey
    band('wt-1')
    const session = screen.getByRole('button', { name: /: show in list$/ })
    expect(session.textContent).toBe('Fix the flaky login testopen')
    fireEvent.click(session)
    expect(reveal).toHaveBeenCalledTimes(1)
  })
})

describe('current path', () => {
  it.each([
    { project: 'web', parent: null, path: ['web'] },
    { project: 'web', parent: { ticket: 'WEB-9', name: 'web-9-parent' }, path: ['web', 'WEB-9'] },
    {
      project: 'web',
      parent: { ticket: null, name: 'parent-folder' },
      path: ['web', 'parent-folder']
    },
    { project: null, parent: null, path: [] }
  ])('$project $parent → $path', ({ path, ...parts }) => {
    expect(currentPath(parts)).toEqual(path)
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

// Why: each hook renders upstream's own element until Pilot attaches.
describe('the menu and settings hooks', () => {
  it.each([
    { attached: false, menu: [], switches: [] },
    {
      attached: true,
      menu: ['Sidebar shows Projects', 'Sidebar shows Activity'],
      switches: [
        'Pin Inbox',
        'Pin Running',
        'Pin Automations',
        'Pin Tasks',
        'Pin Artifacts',
        'Pin Playground'
      ]
    }
  ])('attached=$attached', ({ attached, menu, switches }) => {
    registerPilotStore(attached ? useAppStore : null)
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <SidebarBodyMenuSection />
        </DropdownMenuContent>
      </DropdownMenu>
    )
    expect(screen.queryAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(menu)
    cleanup()
    render(
      <PinnedPagesSettings>
        <span>upstream</span>
      </PinnedPagesSettings>
    )
    expect(screen.queryByText('upstream') === null).toBe(attached)
    expect(screen.queryAllByRole('switch').map((s) => s.getAttribute('aria-label'))).toEqual(
      switches
    )
  })

  it('a settings switch pins its page', () => {
    registerPilotStore(useAppStore)
    render(
      <PinnedPagesSettings>
        <span>upstream</span>
      </PinnedPagesSettings>
    )
    const inbox = screen.getByRole('switch', { name: 'Pin Inbox' })
    expect(inbox.getAttribute('aria-checked')).toBe('true')
    act(() => fireEvent.click(inbox))
    expect(updateSettings).toHaveBeenCalledWith({ pilotPinnedPages: ['running', 'automations'] })
    expect(screen.getByRole('switch', { name: 'Pin Inbox' }).getAttribute('aria-checked')).toBe(
      'false'
    )
  })
})
