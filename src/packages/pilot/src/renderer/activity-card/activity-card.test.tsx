// @vitest-environment happy-dom
import React, { type ReactNode } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentStatusState } from '../../../../../shared/agent-status-types'
import type { WorkspacePort } from '../../../../../shared/workspace-ports'
import { ActivityThreadHoverCard } from '@/components/activity/activity-thread-hover-card'
import type { ActivityEvent, AgentPaneThread } from '@/components/activity/activity-thread-types'
import {
  makeRepo,
  makeTab,
  makeWorkingEntryWithoutHistory,
  makeWorktree
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import type { WorktreeCardPrDisplay } from '@/components/sidebar/worktree-card-pr-display'
import { TooltipProvider } from '@/components/ui/tooltip'
import { openHttpLink } from '@/lib/http-link-routing'
import type * as HttpLinkRouting from '@/lib/http-link-routing'
import { useAppStore } from '@/store'
import { getLinearReadScope, scopedLinearCacheKey } from '@/store/slices/linear/linear-slice-scope'
import { getWorkspaceAttachmentSourceContext } from '@/components/sidebar/workspace-attachment-source-result'
import { registerPilotStore } from '../store'
import { reviewChipLabel, WorktreeLinkStrip } from './WorktreeLinkStrip'
import { reviewPipelineMark, reviewStateMark } from './review-state-mark'
import { StackPortsList } from './StackPortsList'
import { WorktreePortsChip } from './WorktreePortsChip'

vi.mock('@/components/ui/hover-card', () => ({
  HoverCard: ({
    children,
    onOpenChange
  }: {
    children: ReactNode
    onOpenChange?: (open: boolean) => void
  }) => {
    React.useEffect(() => onOpenChange?.(true), [onOpenChange])
    return <>{children}</>
  },
  HoverCardContent: ({ children }: { children: ReactNode }) => (
    <div data-testid="hover-card-content">{children}</div>
  ),
  HoverCardTrigger: ({ children }: { children: ReactNode }) => <>{children}</>
}))
vi.mock('@/lib/http-link-routing', async (importOriginal) => ({
  ...(await importOriginal<typeof HttpLinkRouting>()),
  openHttpLink: vi.fn()
}))
vi.mock('@/runtime/runtime-file-read-client', () => ({
  readRuntimeFileContent: vi.fn(async () => ({
    isBinary: false,
    content:
      'API_PORT=8001\nDB_PORT=5433\nSTAFF_PORT=3005\nSTAFF_PORTAL_URL=http://localhost:3005\n'
  }))
}))

const worktree = { ...makeWorktree(), linkedLinearIssue: 'WEB-2292' }
const thread: AgentPaneThread = {
  paneKey: 'pane-1',
  tab: makeTab(),
  worktree,
  repo: makeRepo(),
  currentAgentState: null,
  currentAgentEntry: null,
  latestEvent: null,
  latestTimestamp: 1,
  agentType: 'claude',
  unread: false,
  paneTitle: 'Start my Todo Linear tickets',
  responsePreview: 'Draft MR is open.',
  events: []
}

function event(state: AgentStatusState, timestamp: number): ActivityEvent {
  return {
    id: `event-${timestamp}`,
    state,
    timestamp,
    observedAt: timestamp,
    worktree,
    repo: makeRepo(),
    entry: { ...makeWorkingEntryWithoutHistory(), state },
    tab: makeTab(),
    agentType: 'claude',
    agentAlive: true,
    unread: false
  }
}

function live(port: number): WorkspacePort {
  const id = `127.0.0.1:${port}`
  return {
    kind: 'external',
    id,
    bindHost: '127.0.0.1',
    connectHost: 'localhost',
    port,
    protocol: 'http'
  }
}

// The key the Workspaces card reads: the issue in "all" workspaces, scoped to its project.
function linearIssueCache() {
  return {
    [scopedLinearCacheKey(
      getLinearReadScope(
        useAppStore.getState().settings,
        getWorkspaceAttachmentSourceContext('linear', makeRepo(), worktree)
      ),
      'all::WEB-2292'
    )]: {
      fetchedAt: Date.now(),
      data: {
        id: 'i1',
        identifier: 'WEB-2292',
        title: 'Add default trait summary',
        url: 'https://linear.app/x/issue/WEB-2292',
        state: { name: 'In Review', type: 'started', color: '#0f783c' },
        team: { id: 't1', name: 'Web', key: 'WEB' },
        labels: [],
        labelIds: [],
        priority: 0,
        updatedAt: '2026-10-19T00:00:00Z'
      }
    }
  }
}

afterEach(() => {
  cleanup()
  registerPilotStore(null)
  vi.clearAllMocks()
})

describe('Pilot’s Activity session card', () => {
  it('shows only the session: its message in full, its states oldest first, and Mark read', async () => {
    registerPilotStore(useAppStore)
    const acknowledgeAgents = vi.fn()
    useAppStore.setState({
      repos: [makeRepo()],
      worktreesByRepo: { 'repo-1': [worktree] },
      linearIssueCache: linearIssueCache(),
      acknowledgeAgents
    })
    const message = `${'The deliverable now binds on release. '.repeat(8)}Tests pass.`
    const view = render(
      <TooltipProvider>
        <ActivityThreadHoverCard
          thread={{
            ...thread,
            unread: true,
            responsePreview: message,
            // Newest first, as the builder sorts them.
            events: [event('done', 3_000), event('waiting', 2_000), event('working', 1_000)]
          }}
        >
          <button type="button">row</button>
        </ActivityThreadHoverCard>
      </TooltipProvider>
    )
    const card = await view.findByTestId('hover-card-content')
    const text = card.textContent ?? ''
    expect(text).toContain('Start my Todo Linear tickets')
    expect(text).toContain('Tests pass.')
    const order = ['Agent working', 'Agent waiting for input', 'Agent finished'].map((part) =>
      text.indexOf(part)
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    // The worktree's links and ports live on its header now.
    expect(text).not.toContain('WEB-2292')
    expect(text).not.toContain('Workspace')

    fireEvent.click(view.getByRole('button', { name: 'Mark read' }))
    expect(acknowledgeAgents).toHaveBeenCalledWith(['pane-1'], undefined, 'explicit')
  })
})

function review(
  provider: 'gitlab' | 'github',
  state: WorktreeCardPrDisplay['state'],
  status: WorktreeCardPrDisplay['status'] = 'success'
): WorktreeCardPrDisplay {
  return { provider, number: 7, title: 'Feature', state, status }
}

describe('the MR / PR chip', () => {
  it.each([
    { provider: 'gitlab', state: 'open', icon: 'GitPullRequest', tone: 'text-status-success' },
    { provider: 'gitlab', state: 'draft', icon: 'GitPullRequest', tone: 'text-status-warning' },
    { provider: 'gitlab', state: 'closed', icon: 'GitPullRequestClosed', tone: 'text-destructive' },
    { provider: 'gitlab', state: 'merged', icon: 'GitMerge', tone: 'text-callout-note' },
    {
      provider: 'github',
      state: 'draft',
      icon: 'GitPullRequestDraft',
      tone: 'text-muted-foreground'
    },
    { provider: 'github', state: 'merged', icon: 'GitMerge', tone: 'text-callout-important' }
  ] as const)('$provider $state draws as its host does', ({ provider, state, icon, tone }) => {
    const mark = reviewStateMark(review(provider, state))
    expect(mark.Icon.displayName).toBe(icon)
    expect(mark.tone).toBe(tone)
  })

  it.each([
    { state: 'open', status: 'failure', label: 'Pipeline failed' },
    { state: 'draft', status: 'pending', label: 'Pipeline in progress' },
    { state: 'merged', status: 'success', label: null },
    { state: 'open', status: 'neutral', label: null }
  ] as const)('a $state MR with a $status pipeline: $label', ({ state, status, label }) => {
    expect(reviewPipelineMark(review('gitlab', state, status))?.label ?? null).toBe(label)
  })

  it('names the review, its state and its pipeline in its tooltip', () => {
    expect(reviewChipLabel(review('gitlab', 'open', 'failure'))).toBe(
      'GitLab MR !7 · Open · Pipeline failed'
    )
    expect(reviewChipLabel(review('github', 'merged'))).toBe('GitHub PR #7 · Merged')
  })
})

describe('WorktreeLinkStrip', () => {
  it('shows the Linear issue as its state mark and ID, in Linear’s colour, and opens it', () => {
    registerPilotStore(useAppStore)
    useAppStore.setState({
      repos: [makeRepo()],
      worktreesByRepo: { 'repo-1': [worktree] },
      linearIssueCache: linearIssueCache()
    })
    const view = render(
      <TooltipProvider>
        <WorktreeLinkStrip worktree={worktree} repo={makeRepo()} />
      </TooltipProvider>
    )
    const chip = view.getByRole('button', {
      name: 'WEB-2292 · In Review · Add default trait summary'
    })
    expect(chip.textContent).toBe('WEB-2292')
    expect(chip.querySelector('svg')?.getAttribute('style')).toContain('color: #0f783c')

    fireEvent.click(chip)
    expect(openHttpLink).toHaveBeenCalledWith('https://linear.app/x/issue/WEB-2292', {
      worktreeId: 'wt-1',
      modifierHeld: false
    })
  })

  it('with no linked issue, shows the one its branch is named for once Linear has it', () => {
    registerPilotStore(useAppStore)
    const unlinked = { ...makeWorktree(), branch: 'refs/heads/web-2153-create-a-review-skill' }
    const fetchLinearIssue = vi.fn(async () => null)
    const before = useAppStore.getState()
    const key = scopedLinearCacheKey(
      getLinearReadScope(useAppStore.getState().settings),
      'selected::WEB-2153'
    )
    const issue = Object.values(linearIssueCache())[0].data
    useAppStore.setState({
      repos: [makeRepo()],
      worktreesByRepo: { 'repo-1': [unlinked] },
      fetchLinearIssue,
      linearIssueCache: {
        [key]: {
          fetchedAt: Date.now(),
          data: { ...issue, identifier: 'WEB-2153', title: 'Review skill' }
        }
      }
    })
    const view = render(
      <TooltipProvider>
        <WorktreeLinkStrip worktree={unlinked} repo={makeRepo()} />
      </TooltipProvider>
    )
    expect(fetchLinearIssue).toHaveBeenCalledWith('WEB-2153')
    expect(view.getByRole('button', { name: 'WEB-2153 · In Review · Review skill' })).toBeTruthy()
    useAppStore.setState({
      fetchLinearIssue: before.fetchLinearIssue,
      linearIssueCache: before.linearIssueCache
    })
  })

  it('renders nothing for a worktree with no MR, issue or live port', () => {
    registerPilotStore(useAppStore)
    useAppStore.setState({ repos: [makeRepo()], worktreesByRepo: { 'repo-1': [makeWorktree()] } })
    const view = render(<WorktreeLinkStrip worktree={makeWorktree()} repo={makeRepo()} />)
    expect(view.container.innerHTML).toBe('')
  })
})

describe('WorktreePortsChip', () => {
  it('counts the stack’s live ports and lists them on click', async () => {
    registerPilotStore(useAppStore)
    const view = render(
      <TooltipProvider>
        <WorktreePortsChip
          worktree={worktree}
          repo={makeRepo()}
          ports={[live(5433), live(8001), live(3005), live(19334)]}
        />
      </TooltipProvider>
    )
    const chip = await view.findByRole('button', { name: 'Show 3 ports' })
    fireEvent.click(chip)
    await waitFor(() => expect(view.getByText('Stack ports (3)')).toBeTruthy())
  })
})

describe('StackPortsList', () => {
  it('names the stack’s live ports from .env.ports, pages first, and folds the rest', async () => {
    registerPilotStore(useAppStore)
    const view = render(
      <TooltipProvider>
        <StackPortsList
          worktree={worktree}
          repo={makeRepo()}
          ports={[live(5433), live(8001), live(3005), live(19334)]}
        />
      </TooltipProvider>
    )
    await waitFor(() => expect(view.getByText('Stack ports (3)')).toBeTruthy())
    const rows = view.getAllByText(/^:\d+$/).map((node) => node.textContent)
    expect(rows).toEqual([':3005', ':8001', ':5433'])
    expect(view.queryByText('19334')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: '+1 other live port' }))
    expect(view.getByText('19334')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Staff' }))
    expect(openHttpLink).toHaveBeenCalledWith('http://localhost:3005', {
      worktreeId: 'wt-1',
      modifierHeld: false
    })
  })
})
