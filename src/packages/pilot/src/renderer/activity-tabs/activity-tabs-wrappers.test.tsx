// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
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
    expect(view.getByTitle('Claude')).toBeTruthy()
  })
})
