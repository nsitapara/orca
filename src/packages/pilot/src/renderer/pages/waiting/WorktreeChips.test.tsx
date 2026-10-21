// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { openHttpLink } from '@/lib/http-link-routing'
import type * as HttpLinkRouting from '@/lib/http-link-routing'
import { useAppStore } from '@/store'
import { getLinearReadScope, scopedLinearCacheKey } from '@/store/slices/linear/linear-slice-scope'
import type { ItemFields } from '../../../shared/api-types'
import { groupOf } from '../../../shared/inbox-groups'
import { LOCAL_PILOT_HOST } from '../../hosts/pilot-host'
import { WorktreeChips } from './WorktreeChips'

vi.mock('@/lib/http-link-routing', async (importOriginal) => ({
  ...(await importOriginal<typeof HttpLinkRouting>()),
  openHttpLink: vi.fn()
}))

const GROUP = groupOf({ itemKey: 'mr:1633', worktreePath: null, automationId: 'a' }, [])
const URL = 'https://gitlab.com/g/web-platform/-/merge_requests/1633'
const FIELDS: ItemFields = {
  'mr.iid': 1633,
  'mr.web_url': URL,
  'mr.state': 'open',
  'mr.draft': false,
  'mr.pipeline_status': 'success',
  'mr.branch': 'web-2122-ticket-priority-sample-detail-link'
}

function chips(fields: ItemFields | null) {
  return render(
    <TooltipProvider>
      <WorktreeChips group={GROUP} host={LOCAL_PILOT_HOST} fields={fields} />
    </TooltipProvider>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("an MR card's chips with no worktree in the app", () => {
  it("shows its MR from its run's item, and opens it", () => {
    chips(FIELDS)
    const mr = screen.getByRole('button', { name: 'GitLab MR !1633 · Open · Pipeline passed' })
    expect(mr.textContent).toBe('!1633')
    fireEvent.click(mr)
    expect(openHttpLink).toHaveBeenCalledWith(URL, { worktreeId: undefined, modifierHeld: false })
  })

  it('adds the Linear issue its branch is named for, once Linear has it', () => {
    const fetchLinearIssue = vi.fn(async () => null)
    const key = scopedLinearCacheKey(
      getLinearReadScope(useAppStore.getState().settings),
      'selected::WEB-2122'
    )
    const before = useAppStore.getState()
    useAppStore.setState({
      fetchLinearIssue,
      linearIssueCache: {
        [key]: {
          fetchedAt: Date.now(),
          data: {
            id: 'i1',
            identifier: 'WEB-2122',
            title: 'Ticket priority',
            url: 'https://linear.app/x/issue/WEB-2122',
            state: { name: 'In Progress', type: 'started', color: '#f2c94c' },
            team: { id: 't1', name: 'Web', key: 'WEB' },
            labels: [],
            labelIds: [],
            priority: 0,
            updatedAt: '2026-10-21T00:00:00Z'
          }
        }
      }
    })
    chips(FIELDS)
    expect(fetchLinearIssue).toHaveBeenCalledWith('WEB-2122')
    fireEvent.click(
      screen.getByRole('button', { name: 'WEB-2122 · In Progress · Ticket priority' })
    )
    expect(openHttpLink).toHaveBeenCalledWith('https://linear.app/x/issue/WEB-2122', {
      worktreeId: undefined,
      modifierHeld: false
    })
    useAppStore.setState({
      fetchLinearIssue: before.fetchLinearIssue,
      linearIssueCache: before.linearIssueCache
    })
  })

  it('shows nothing when its run carried no item fields (an older Pilot)', () => {
    const view = chips(null)
    expect(view.container.querySelector('button')).toBeNull()
  })
})
