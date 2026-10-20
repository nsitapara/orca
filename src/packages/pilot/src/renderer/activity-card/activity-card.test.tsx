// @vitest-environment happy-dom
import React, { type ReactNode } from 'react'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspacePort } from '../../../../../shared/workspace-ports'
import { ActivityThreadHoverCard } from '@/components/activity/activity-thread-hover-card'
import type { AgentPaneThread } from '@/components/activity/activity-thread-types'
import {
  makeRepo,
  makeTab,
  makeWorktree
} from '@/components/activity/ActivityPrototypePage-test-fixtures'
import { TooltipProvider } from '@/components/ui/tooltip'
import { openHttpLink } from '@/lib/http-link-routing'
import type * as HttpLinkRouting from '@/lib/http-link-routing'
import { getRevealInFileManagerLabel } from '@/lib/reveal-in-file-manager'
import { useAppStore } from '@/store'
import { getLinearReadScope, scopedLinearCacheKey } from '@/store/slices/linear/linear-slice-scope'
import { getWorkspaceAttachmentSourceContext } from '@/components/sidebar/workspace-attachment-source-result'
import { registerPilotStore } from '../store'
import { HoverCardPorts } from './HoverCardPorts'

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

afterEach(() => {
  cleanup()
  registerPilotStore(null)
  vi.clearAllMocks()
})

describe('Pilot’s Activity hover card', () => {
  it('leads with the links and ends with the session, with the file manager on Workspace', async () => {
    registerPilotStore(useAppStore)
    useAppStore.setState({
      repos: [makeRepo()],
      worktreesByRepo: { 'repo-1': [worktree] },
      // The key the Workspaces card reads: the issue in "all" workspaces, scoped to its project.
      linearIssueCache: {
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
            state: { name: 'In Review', type: 'started', color: '#fff' },
            team: { id: 't1', name: 'Web', key: 'WEB' },
            labels: [],
            labelIds: [],
            priority: 0,
            updatedAt: '2026-10-19T00:00:00Z'
          }
        }
      }
    })
    const view = render(
      <TooltipProvider>
        <ActivityThreadHoverCard thread={thread}>
          <button type="button">row</button>
        </ActivityThreadHoverCard>
      </TooltipProvider>
    )
    const card = await view.findByTestId('hover-card-content')
    const text = card.textContent ?? ''
    const order = ['WEB-2292· In Review', 'Workspace', 'Start my Todo Linear tickets'].map((part) =>
      text.indexOf(part)
    )
    expect(order.every((at) => at >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(view.getByLabelText(getRevealInFileManagerLabel())).toBeTruthy()

    fireEvent.click(view.getByTitle('Open WEB-2292 in Linear'))
    expect(openHttpLink).toHaveBeenCalledWith('https://linear.app/x/issue/WEB-2292', {
      worktreeId: 'wt-1',
      modifierHeld: false
    })
  })
})

describe('HoverCardPorts', () => {
  it('names the stack’s live ports from .env.ports, pages first, and folds the rest', async () => {
    registerPilotStore(useAppStore)
    const view = render(
      <TooltipProvider>
        <HoverCardPorts
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
