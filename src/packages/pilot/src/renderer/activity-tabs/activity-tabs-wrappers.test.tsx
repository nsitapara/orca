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
import { ActivityTabsFooterLabel } from '../activity-card/ActivityTabsFooterLabel'
import { withGroupRows } from './activity-tabs-rows'
import { setActivityInactiveExpanded } from './activity-tabs-setting'
import { RecentWorktreeRow } from './RecentWorktreeRow'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import {
  ActivityTabsThreadFooterIcon,
  ActivityTabsThreadLeadingIcon
} from './ActivityTabsThreadIcons'

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
    header: <ActivityTabsGroupHeader group={group}>{UPSTREAM}</ActivityTabsGroupHeader>,
    leading: (
      <ActivityTabsThreadLeadingIcon thread={thread}>{UPSTREAM}</ActivityTabsThreadLeadingIcon>
    ),
    footer: <ActivityTabsThreadFooterIcon thread={thread}>{UPSTREAM}</ActivityTabsThreadFooterIcon>,
    // Why the provider: the nest tells its rows their group; the footer swaps only under a worktree.
    footerLabel: (
      <ActivityRowGroupContext.Provider value={groupKey}>
        <ActivityTabsFooterLabel worktree={thread.worktree} repo={thread.repo}>
          {UPSTREAM}
        </ActivityTabsFooterLabel>
      </ActivityRowGroupContext.Provider>
    )
  }
}

afterEach(() => {
  cleanup()
  registerPilotStore(null)
  vi.clearAllMocks()
})

describe('Pilot wrappers around upstream Activity elements', () => {
  it.each([
    { attached: false, groupKey: 'worktree:wt-1', pilot: [] },
    {
      attached: true,
      groupKey: 'worktree:wt-1',
      pilot: ['nest', 'header', 'leading', 'footer', 'footerLabel']
    },
    {
      attached: true,
      groupKey: 'pilot:inactive-worktrees',
      pilot: ['nest', 'header', 'leading', 'footer']
    },
    { attached: true, groupKey: 'done', pilot: ['leading', 'footer'] }
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

  it('a worktree header names its project, and a thread row leads with its agent', () => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
    const { header, leading } = views('worktree:wt-1')
    const view = render(
      <TooltipProvider>
        {header}
        {leading}
      </TooltipProvider>
    )
    expect(view.getByTitle('feature').textContent).toBe('feature')
    expect(view.getByText('Repo')).toBeTruthy()
    expect(view.getByTitle('Claude')).toBeTruthy()
  })

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

  // Why: the menu's items render in a portal whose clicks bubble to the header; the pick opens its own tab.
  it('a pick in a worktree header’s New agent menu doesn’t also open the worktree', async () => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
    const user = userEvent.setup()
    const view = render(
      <TooltipProvider>
        <ActivityTabsGroupHeader group={{ key: 'worktree:wt-1', label: 'feature', threads: [] }}>
          {UPSTREAM}
        </ActivityTabsGroupHeader>
      </TooltipProvider>
    )

    await user.click(view.getByRole('button', { name: 'New agent' }))
    await user.click(await view.findByRole('menuitem', { name: /Claude/ }))

    expect(launchAgentInNewTab).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude' }))
    expect(activateAndRevealWorkspace).not.toHaveBeenCalled()
  })
})
