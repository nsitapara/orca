// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import {
  makeRepo,
  makeTab,
  makeWorktree
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { registerPilotStore } from '../store'
import { ActivityTabsGroupHeader } from './ActivityTabsGroupHeader'
import { ActivityTabsNest } from './ActivityTabsNest'
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
    footer: <ActivityTabsThreadFooterIcon thread={thread}>{UPSTREAM}</ActivityTabsThreadFooterIcon>
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
    { attached: true, groupKey: 'worktree:wt-1', pilot: ['nest', 'header', 'leading', 'footer'] },
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
    expect(
      view.container.querySelector('button[aria-expanded] .lucide-chevron-down')
    ).not.toBeNull()
    expect(view.getByTitle('Claude')).toBeTruthy()
  })

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
      expect(setWorktreesPinnedAndReveal).toHaveBeenCalledWith(['wt-1'], next)
      expect(onToggle).not.toHaveBeenCalled()
    }
  )

  it('a worktree header with no sessions has no chevron, but keeps New agent', () => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
    const empty = { key: 'worktree:wt-1', label: 'feature', threads: [] }
    const view = render(
      <TooltipProvider>
        <ActivityTabsGroupHeader group={empty}>{UPSTREAM}</ActivityTabsGroupHeader>
      </TooltipProvider>
    )
    expect(view.container.querySelector('.lucide-chevron-down')).toBeNull()
    expect(view.getByRole('button', { name: 'New agent' })).toBeTruthy()
  })

  // Why: as in Projects, a click opens the worktree as a user open, so an empty one gets its default surface.
  it.each([
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
  ])('clicking $name opens its worktree', ({ element }) => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
    const view = render(<TooltipProvider>{element}</TooltipProvider>)

    fireEvent.click(view.getByText('feature'))

    expect(activateAndRevealWorkspace).toHaveBeenCalledWith(
      'wt-1',
      expect.objectContaining({ navigationIntent: 'user-open' })
    )
  })

  it('a worktree header’s chevron folds its sessions without opening the worktree', () => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
    const onToggle = vi.fn()
    const view = render(
      <TooltipProvider>
        <ActivityTabsGroupHeader
          group={{ key: 'worktree:wt-1', label: 'feature', threads: [thread] }}
          onToggle={onToggle}
        >
          {UPSTREAM}
        </ActivityTabsGroupHeader>
      </TooltipProvider>
    )

    fireEvent.click(view.getByRole('button', { name: 'Hide sessions' }))

    expect(onToggle).toHaveBeenCalledOnce()
    expect(activateAndRevealWorkspace).not.toHaveBeenCalled()
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
