// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import {
  makeRepo,
  makeTab,
  makeWorktree,
  makeWorktreeWithId
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { getHostedReviewCacheKey } from '@/store/slices/hosted-review-cache-identity'
import { registerPilotStore } from '../store'
import { ActivityTabsGroupHeader } from './ActivityTabsGroupHeader'
import { ActivityTabsNest } from './ActivityTabsNest'
import { ActivityRowGroupContext } from './activity-row-group-context'
import { withChildGroups, withGroupRows } from './activity-tabs-rows'
import { getWorktreeLineageGroupKey } from '../../../../../shared/sidebar-list/group-keys'
import { setActivityInactiveExpanded } from './activity-tabs-setting'
import { toggleWorktreeGroupFold } from './activity-worktree-folds'
import { RecentWorktreeRow } from './RecentWorktreeRow'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { ActivityTabsThreadRow } from './ActivityTabsThreadRow'

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

const UPSTREAM = <span>upstream</span>

vi.mock('@/lib/worktree-activation', () => ({
  activateAndRevealWorkspace: vi.fn(() => ({ primaryTabId: null }))
}))
vi.mock('@/hooks/useAgentDetectionTarget', () => ({
  useAgentDetectionTargetForWorktree: () => null
}))
vi.mock('@/hooks/useDetectedAgents', () => ({
  useDetectedAgents: () => ({ detectedIds: ['claude'] })
}))
vi.mock('@/hooks/useShortcutLabel', () => ({ useOptionalShortcutLabel: () => null }))
vi.mock('@/lib/launch-agent-in-new-tab', () => ({
  launchAgentInNewTab: vi.fn(() => ({ surface: { kind: 'local-terminal', tabId: 'tab-1' } }))
}))

// Each wrapper renders upstream's own element until Pilot attaches; then only for groups it restyles.
function views(groupKey: string) {
  const group = { key: groupKey, label: 'feature', threads: [thread] }
  return {
    nest: <ActivityTabsNest groupKey={groupKey}>{UPSTREAM}</ActivityTabsNest>,
    header: <ActivityTabsGroupHeader group={group}>{UPSTREAM}</ActivityTabsGroupHeader>
  }
}

const noop = () => {}

// Why the provider: the nest tells its rows their group; grouped by worktree, a row doesn't name it.
function threadRow(row: AgentPaneThread, groupKey: string | null = null) {
  return (
    <TooltipProvider>
      <ActivityRowGroupContext.Provider value={groupKey}>
        <ActivityTabsThreadRow
          thread={row}
          selected={false}
          onSelect={noop}
          onJump={noop}
          onMarkRead={noop}
          onMarkUnread={noop}
          canJump={false}
          compactMode
        />
      </ActivityRowGroupContext.Provider>
    </TooltipProvider>
  )
}

afterEach(() => {
  cleanup()
  registerPilotStore(null)
  vi.clearAllMocks()
})

describe('Pilot wrappers around upstream Activity elements', () => {
  it.each([
    { attached: false, groupKey: 'worktree:wt-1', pilot: [] },
    { attached: true, groupKey: 'worktree:wt-1', pilot: ['nest', 'header'] },
    { attached: true, groupKey: 'pilot:inactive-worktrees', pilot: ['nest', 'header'] },
    { attached: true, groupKey: 'done', pilot: [] }
  ] as const)(
    'attached=$attached $groupKey → Pilot renders $pilot',
    ({ attached, groupKey, pilot }) => {
      registerPilotStore(attached ? useAppStore : null)
      useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
      const replaced = Object.entries(views(groupKey)).filter(([, element]) => {
        const view = render(<TooltipProvider>{element}</TooltipProvider>)
        const markup = view.container.innerHTML
        cleanup()
        return markup !== '<span>upstream</span>'
      })
      expect(replaced.map(([name]) => name)).toEqual(pilot)
    }
  )

  it('a worktree header names its project', () => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
    const view = render(<TooltipProvider>{views('worktree:wt-1').header}</TooltipProvider>)
    expect(view.getByTitle('feature').textContent).toBe('feature')
    expect(view.getByText('Repo')).toBeTruthy()
  })

  // Why: a session is one line, as in Projects: its state, agent, title and status, its bell and time
  // together. Grouped by worktree the header names the worktree; grouped otherwise the line does.
  it.each([
    { groupKey: 'worktree:wt-1', unread: true, text: 'Fix the build - Tests pass', names: false },
    { groupKey: null, unread: false, text: 'Fix the build - Tests pass', names: true }
  ])(
    'a session row under $groupKey (unread $unread) is one line',
    ({ groupKey, unread, text, names }) => {
      registerPilotStore(useAppStore)
      const session = {
        ...thread,
        paneTitle: 'Fix the build',
        responsePreview: 'Tests pass',
        unread
      }
      const view = render(threadRow(session, groupKey))
      const row = view.getByRole('listitem', { name: 'Fix the build' })
      // The title's button is named by its text, so the status is read out too.
      expect(view.getByRole('button', { name: text })).toBeTruthy()
      // The bell and time sit in the row itself, not in a footer line under the title.
      const bell = view.getByRole('button', {
        name: unread ? 'Mark thread as read' : 'Mark thread unread'
      })
      expect(bell.parentElement).toBe(row)
      expect(view.queryByTitle('feature') !== null).toBe(names)
    }
  )

  // Why: an automation's session (its tab named so at launch) reads as automation; the tooltip still names the agent.
  it.each([
    { customTitle: null, icon: 'Claude' },
    { customTitle: '[Automation] Fix CI · !1561', icon: 'Automation run (Claude)' }
  ])('a session row whose tab is named $customTitle shows $icon', ({ customTitle, icon }) => {
    registerPilotStore(useAppStore)
    const view = render(threadRow({ ...thread, tab: { ...thread.tab, customTitle } }))
    expect(view.getByTitle(icon)).toBeTruthy()
    expect(view.queryByTitle('Claude') !== null).toBe(customTitle === null)
  })

  // Why: like a worktree header, a recent worktree's row says whose worktree it is; grouped by project, its group does.
  it.each([
    { groupKey: 'pilot:inactive-worktrees', project: true },
    { groupKey: 'pilot:pinned-worktrees', project: true },
    { groupKey: 'project:repo-1', project: false }
  ])(
    'a recent worktree row under $groupKey names its project: $project',
    ({ groupKey, project }) => {
      registerPilotStore(useAppStore)
      useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
      const item = { key: 'recent:wt-1', worktree: makeWorktree(), repo: makeRepo(), pinned: false }
      const view = render(
        <TooltipProvider>
          <RecentWorktreeRow item={item} groupKey={groupKey} />
        </TooltipProvider>
      )
      expect(view.getByTitle('feature').textContent).toBe('feature')
      expect(view.queryByText('Repo') !== null).toBe(project)
    }
  )

  // Why: a Pilot run's throwaway is a child of the worktree it checked out, and reads as part of it.
  it.each([
    { view: 'header', groupKey: 'worktree:wt-kid', guides: 1, project: false },
    { view: 'nest', groupKey: 'worktree:wt-kid', guides: 2, project: false },
    { view: 'header', groupKey: 'worktree:wt-1', guides: 0, project: true },
    { view: 'nest', groupKey: 'worktree:wt-1', guides: 1, project: false }
  ] as const)(
    'a child worktree sits on its parent’s guide line: $view $groupKey → $guides line(s)',
    ({ view, groupKey, guides, project }) => {
      registerPilotStore(useAppStore)
      useAppStore.setState({
        repos: [makeRepo()],
        worktreesByRepo: {
          'repo-1': [
            { ...makeWorktree(), instanceId: 'i-parent' },
            { ...makeWorktreeWithId('wt-kid'), branch: '', instanceId: 'i-kid' }
          ]
        },
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
      const rendered = render(<TooltipProvider>{views(groupKey)[view]}</TooltipProvider>)
      expect(rendered.container.querySelectorAll('.border-l')).toHaveLength(guides)
      expect(rendered.queryByText('Repo') !== null).toBe(project)
    }
  )

  it.each([
    { isPinned: false, label: 'Pin worktree', next: true },
    { isPinned: true, label: 'Unpin worktree', next: false }
  ])(
    'the header’s "$label" sets the Workspaces pin, not the group’s collapse',
    ({ isPinned, label, next }) => {
      registerPilotStore(useAppStore)
      const setWorktreesPinnedAndReveal = vi.fn()
      useAppStore.setState({
        repos: [makeRepo()],
        worktreesByRepo: { 'repo-1': [{ ...makeWorktree(), isPinned }] },
        setWorktreesPinnedAndReveal
      })
      const onToggle = vi.fn()
      const group = { key: 'worktree:wt-1', label: 'feature', threads: [thread] }
      const view = render(
        <TooltipProvider>
          <ActivityTabsGroupHeader group={group} onToggle={onToggle}>
            {UPSTREAM}
          </ActivityTabsGroupHeader>
        </TooltipProvider>
      )
      fireEvent.click(view.getByRole('button', { name: label }))
      expect(setWorktreesPinnedAndReveal).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'wt-1' })],
        next
      )
      expect(onToggle).not.toHaveBeenCalled()
    }
  )

  // Why: no fold keeps every worktree's folder icon in one column, on its guide line.
  it.each([
    { sessions: 'sessions', threads: [thread] },
    { sessions: 'no sessions', threads: [] }
  ])('a worktree header with $sessions has no chevron, but keeps New agent', ({ threads }) => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
    const group = { key: 'worktree:wt-1', label: 'feature', threads }
    const view = render(
      <TooltipProvider>
        <ActivityTabsGroupHeader group={group}>{UPSTREAM}</ActivityTabsGroupHeader>
      </TooltipProvider>
    )
    expect(view.container.querySelector('.lucide-chevron-down')).toBeNull()
    expect(view.getByRole('button', { name: 'New agent' })).toBeTruthy()
  })

  const worktreeSurfaces = [
    {
      name: 'a worktree header',
      element: (
        <ActivityTabsGroupHeader group={{ key: 'worktree:wt-1', label: 'feature', threads: [] }}>
          {UPSTREAM}
        </ActivityTabsGroupHeader>
      )
    },
    {
      name: 'a recent worktree row',
      element: (
        <RecentWorktreeRow
          item={{ key: 'recent:wt-1', worktree: makeWorktree(), repo: makeRepo(), pinned: false }}
          groupKey="pilot:inactive-worktrees"
        />
      )
    }
  ]

  // Why: as in Projects, a click opens the worktree as a user open, so an empty one gets its default surface.
  it.each(worktreeSurfaces)('clicking $name opens its worktree', ({ element }) => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
    const view = render(<TooltipProvider>{element}</TooltipProvider>)

    fireEvent.click(view.getByText('feature'))

    expect(activateAndRevealWorkspace).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ navigationIntent: 'user-open' })
    )
  })

  it.each(worktreeSurfaces)(
    'right-clicking $name opens the Projects worktree menu, not the worktree',
    async ({ element }) => {
      registerPilotStore(useAppStore)
      useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
      const view = render(<TooltipProvider>{element}</TooltipProvider>)

      fireEvent.contextMenu(view.getByText('feature'))

      expect(await view.findByRole('menuitem', { name: /Copy Path/ })).toBeTruthy()
      expect(activateAndRevealWorkspace).not.toHaveBeenCalled()
    }
  )

  // Why: a merged MR is the sign a worktree is ready to go; the button is the Projects menu's own Delete.
  it.each(
    worktreeSurfaces.flatMap((surface) =>
      (['merged', 'open'] as const).map((state) => ({ ...surface, state }))
    )
  )('$name with a $state MR shows its chip, and Delete only once merged', ({ element, state }) => {
    registerPilotStore(useAppStore)
    const repo = makeRepo()
    const key = getHostedReviewCacheKey(repo.path, 'feature', null, repo.id, null, null, true)
    useAppStore.setState({
      repos: [repo],
      worktreesByRepo: { 'repo-1': [makeWorktree()] },
      activeModal: 'none',
      hostedReviewCache: {
        // A branch lookup: no linked MR asked for it.
        [key]: {
          fetchedAt: Date.now(),
          linkedReviewHintKey: '',
          data: {
            provider: 'gitlab',
            number: 7,
            title: 'Feature',
            state,
            url: 'https://gitlab.com/x/-/merge_requests/7',
            status: 'success',
            updatedAt: '2026-10-20T00:00:00Z',
            mergeable: 'MERGEABLE',
            headSha: 'abc123'
          }
        }
      }
    })
    const view = render(<TooltipProvider>{element}</TooltipProvider>)

    const chip = view.getByRole('button', {
      name: state === 'open' ? 'GitLab MR !7 · Open · Pipeline passed' : 'GitLab MR !7 · Merged'
    })
    expect(chip.textContent).toBe('!7')

    const button = view.queryByRole('button', { name: 'Delete worktree' })
    if (state === 'open') {
      expect(button).toBeNull()
      return
    }
    fireEvent.click(button!)
    expect(useAppStore.getState().activeModal).toBe('delete-worktree')
    expect(activateAndRevealWorkspace).not.toHaveBeenCalled()
  })

  it('the Inactive header starts folded, counts its worktrees, and folds on Pilot’s own flag', () => {
    registerPilotStore(useAppStore)
    setActivityInactiveExpanded(false)
    const onToggle = vi.fn()
    const recent = { key: 'r', worktree: makeWorktree(), repo: makeRepo(), pinned: false }
    const group = withGroupRows(
      { key: 'pilot:inactive-worktrees', label: 'Inactive', threads: [] },
      [
        { kind: 'recent-worktree', recent },
        { kind: 'recent-worktree', recent: { ...recent, key: 'r2' } }
      ]
    )
    const view = render(
      <TooltipProvider>
        <ActivityTabsGroupHeader group={group} onToggle={onToggle}>
          {UPSTREAM}
        </ActivityTabsGroupHeader>
      </TooltipProvider>
    )

    const header = view.getByRole('button', { name: 'Show inactive worktrees' })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(header.textContent).toBe('Inactive2')
    fireEvent.click(header)

    expect(view.getByRole('button', { name: 'Hide inactive worktrees' })).toBeTruthy()
    expect(onToggle).not.toHaveBeenCalled()
    expect(activateAndRevealWorkspace).not.toHaveBeenCalled()
    setActivityInactiveExpanded(false)
  })

  // Why: the menu's items render in a portal whose clicks bubble to the header; the pick opens its own
  // tab. A folded worktree unfolds as it opens, so the new session shows (an Inactive row's menu too).
  it('a pick in a folded worktree header’s New agent menu unfolds it, without also opening it', async () => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
    toggleWorktreeGroupFold('worktree:wt-1')
    const savedFolds = () =>
      JSON.parse(window.localStorage.getItem('pilot.activity.folded-worktrees') ?? '[]')
    expect(savedFolds()).toEqual(['worktree:wt-1'])
    const user = userEvent.setup()
    const view = render(
      <TooltipProvider>
        <ActivityTabsGroupHeader
          group={{ key: 'worktree:wt-1', label: 'feature', threads: [] }}
          collapsed
          onToggle={vi.fn()}
        >
          {UPSTREAM}
        </ActivityTabsGroupHeader>
      </TooltipProvider>
    )

    await user.click(view.getByRole('button', { name: 'New agent' }))
    await user.click(await view.findByRole('menuitem', { name: /Claude/ }))

    expect(launchAgentInNewTab).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude' }))
    expect(activateAndRevealWorkspace).not.toHaveBeenCalled()
    vi.mocked(launchAgentInNewTab).mock.calls[0]![0].beforeSurfaceOpen?.({ kind: 'host-published' })
    expect(savedFolds()).toEqual([])
  })

  // Why: a worktree folds its own sessions from its folder icon, and its child worktrees from Projects'
  // own "N children" chip, apart; neither opens the worktree, and a fold hiding an unread session says so.
  it('a worktree header folds its sessions and its children apart, opening nothing', () => {
    registerPilotStore(useAppStore)
    const worktree = makeWorktree()
    const toggleCollapsedGroup = vi.fn()
    useAppStore.setState({
      repos: [makeRepo()],
      worktreesByRepo: { 'repo-1': [worktree] },
      collapsedGroups: new Set([getWorktreeLineageGroupKey(worktree)]),
      toggleCollapsedGroup
    })
    const onToggle = vi.fn()
    const kid = { key: 'worktree:wt-kid', label: 'kid', threads: [{ ...thread, unread: true }] }
    const group = withChildGroups({ key: 'worktree:wt-1', label: 'feature', threads: [thread] }, [
      kid
    ])
    const view = render(
      <TooltipProvider>
        <ActivityTabsGroupHeader group={group} onToggle={onToggle}>
          {UPSTREAM}
        </ActivityTabsGroupHeader>
      </TooltipProvider>
    )

    const fold = view.getByRole('button', { name: 'Collapse worktree' })
    expect(fold.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(fold)
    expect(onToggle).toHaveBeenCalledTimes(1)

    const chip = view.getByRole('button', { name: 'Show 1 child workspace' })
    expect(chip.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(chip)
    expect(toggleCollapsedGroup).toHaveBeenCalledWith(getWorktreeLineageGroupKey(worktree))
    expect(view.getByRole('img', { name: 'Unread sessions folded' })).toBeTruthy()
    expect(activateAndRevealWorkspace).not.toHaveBeenCalled()
  })

  // Why: the selected worktree's header, the open session and the Current header agree, whichever
  // row was clicked last; the accent covers the header only, not the worktree's sessions.
  it.each([
    {
      active: 'wt-1',
      tabType: 'terminal',
      tabId: 'tab-1',
      clicked: false,
      header: true,
      open: true
    },
    {
      active: 'wt-1',
      tabType: 'terminal',
      tabId: 'tab-2',
      clicked: true,
      header: true,
      open: false
    },
    {
      active: 'wt-1',
      tabType: 'agent-session',
      tabId: null,
      clicked: true,
      header: true,
      open: true
    },
    {
      active: 'wt-2',
      tabType: 'terminal',
      tabId: 'tab-1',
      clicked: true,
      header: false,
      open: false
    }
  ] as const)(
    'selected $active, $tabType tab $tabId, row clicked $clicked → header $header, session open $open',
    ({ active, tabType, tabId, clicked, header, open }) => {
      registerPilotStore(useAppStore)
      useAppStore.setState({
        repos: [makeRepo()],
        worktreesByRepo: { 'repo-1': [makeWorktree()] },
        activeWorktreeId: active,
        activeTabType: tabType,
        activeTabId: tabId
      })
      const view = render(
        <TooltipProvider>
          {views('worktree:wt-1').header}
          <ActivityTabsThreadRow
            thread={thread}
            selected={clicked}
            onSelect={noop}
            onJump={noop}
            onMarkRead={noop}
            onMarkUnread={noop}
            canJump={false}
            compactMode
          />
        </TooltipProvider>
      )
      const headerRow = view.container.querySelector('[data-pilot-worktree-header="wt-1"]')
      expect(headerRow?.hasAttribute('data-pilot-selected-worktree')).toBe(header)
      expect(headerRow?.getAttribute('aria-current') === 'true').toBe(header)
      const row = view.getByRole('listitem')
      expect(row.hasAttribute('data-pilot-open-session')).toBe(open)
      expect(row.getAttribute('aria-current') === 'true').toBe(open)
    }
  )
})
