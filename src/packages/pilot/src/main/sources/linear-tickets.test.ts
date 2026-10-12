import { describe, expect, it, vi } from 'vitest'
import type {
  LinearIssueListResult,
  LinearIssueSummary
} from '../../../../../shared/linear/agent-access'
import type { LinearConnector } from '../linear-connector/linear-connector'
import { PEOPLE, fakeGlab, sourceContext } from './__fixtures__/source-context'
import { findTicketWorktree, linearTicketSource } from './linear-tickets'
import type { Item } from './types'
import type { GitRunner } from './worktree-git'
import type { WorktreeRecord } from './worktree-records'

type Listed = LinearIssueListResult['issues'][number]
function listed(ident: string, type: string, priority: number, workspace = 'ws1'): Listed {
  return {
    id: `uuid-${ident}`,
    identifier: ident,
    title: `Ticket ${ident}`,
    url: `https://linear.app/x/issue/${ident}`,
    state: { name: type === 'unstarted' ? 'Todo' : type, type },
    team: { key: 'WEB', name: 'Web Dev' },
    assignee: { id: 'u-nish', displayName: 'Nish' },
    priority,
    workspace: { id: workspace, name: 'X' }
  } as Listed
}
function detail(item: Listed, created: string, branch: string | null): LinearIssueSummary {
  return { ...item, labels: [], branchName: branch, createdAt: created } as LinearIssueSummary
}
const meta = {
  filter: 'assigned' as const,
  limit: 200,
  returned: 0,
  hasMore: false,
  partial: false,
  workspaceErrors: []
}

// linear-todo-sweep test_sweep.py's tickets: URGENT, HIGH-OLD, HIGH-NEW, LOW, NONE-OLD (+ two not Todo).
const LISTING: Listed[] = [
  listed('NONE-OLD', 'unstarted', 0),
  listed('LOW', 'unstarted', 4),
  listed('URGENT', 'unstarted', 1),
  listed('HIGH-NEW', 'unstarted', 2),
  listed('HIGH-OLD', 'unstarted', 2),
  listed('BACKLOG', 'backlog', 1),
  listed('STARTED', 'started', 1)
]
const CREATED: Record<string, string> = {
  'NONE-OLD': '2026-01-01T00:00:00Z',
  LOW: '2026-10-01T00:00:00Z',
  URGENT: '2026-10-01T00:00:00Z',
  'HIGH-NEW': '2026-10-05T00:00:00Z',
  'HIGH-OLD': '2026-09-01T00:00:00Z'
}
const BRANCH: Record<string, string | null> = {
  URGENT: 'web-1-urgent',
  'HIGH-OLD': 'web-2-high-old',
  'HIGH-NEW': 'web-3-high-new',
  LOW: null,
  'NONE-OLD': 'web-5-none-old'
}

function connector(list: LinearIssueListResult = { issues: LISTING, meta }) {
  const linear = {
    listIssues: vi.fn(async () => list),
    issue: vi.fn(async (id: string) => {
      const item = LISTING.find((i) => i.identifier === id) as Listed
      return detail(item, CREATED[id], BRANCH[id])
    })
  }
  return linear as typeof linear & LinearConnector
}

const wt = (path: string, branch: string, linear: string | null = null): WorktreeRecord => ({
  id: `repo1::${path}`,
  path,
  branch,
  head: 'h',
  isArchived: false,
  isMain: false,
  linkedLinearIssue: linear
})
const WORKTREES = [
  wt('/wt/linked', 'other-name', 'URGENT'), // linked to URGENT though on another branch
  wt('/wt/high-old', 'web-2-high-old'), // HIGH-OLD's branch, not linked
  wt('/wt/archived', 'web-3-high-new')
]
WORKTREES[2].isArchived = true

// HIGH-NEW's branch exists locally without a worktree.
const git: GitRunner = async (args) => {
  if (args.join(' ') === 'show-ref --verify --quiet refs/heads/web-3-high-new') {
    return { stdout: '' }
  }
  throw Object.assign(new Error('exit 1'), { code: 1 })
}
const gitlab = fakeGlab((path) => {
  if (path === 'root:user') {
    return { username: 'nish8' }
  }
  if (path === 'merge_requests?source_branch=web-2-high-old&per_page=100&page=1') {
    return [
      {
        iid: 1588,
        state: 'opened',
        web_url: 'https://gitlab.com/p/-/merge_requests/1588',
        author: { username: 'shivan2418' }
      }
    ]
  }
  if (path.startsWith('merge_requests?source_branch=')) {
    return []
  }
  return path.endsWith('/approvals') ? {} : undefined
})

function source(linear: LinearConnector) {
  return linearTicketSource({
    linear,
    listWorktrees: async () => WORKTREES,
    git
  })
}
const context = (over = {}) => sourceContext(over, gitlab)
const M01 = { state_type: ['unstarted'], has_branch: true }

describe('linearTicketSource', () => {
  it("M01: Todo tickets only, details read for those alone, in M01's order", async () => {
    const linear = connector()
    const { items } = await source(linear).list(context(), M01)
    expect(items.map((i) => i.key)).toEqual([
      'linear:URGENT',
      'linear:HIGH-OLD',
      'linear:HIGH-NEW',
      'linear:LOW',
      'linear:NONE-OLD'
    ])
    expect(linear.listIssues).toHaveBeenCalledWith('assigned')
    expect(linear.issue.mock.calls.map((c) => c[0]).sort()).toEqual([
      'HIGH-NEW',
      'HIGH-OLD',
      'LOW',
      'NONE-OLD',
      'URGENT'
    ])
    expect(linear.issue).toHaveBeenCalledWith('URGENT', 'ws1')
  })

  it('links worktrees, says whether a lone branch exists, and reads ownership for a worktree', async () => {
    const { items } = await source(connector()).list(context(), M01)
    const byKey = Object.fromEntries(items.map((i) => [i.key, i]))
    expect(byKey['linear:URGENT'].worktreeHint).toEqual({
      id: 'repo1::/wt/linked',
      path: '/wt/linked',
      branch: 'other-name',
      linearIssue: 'URGENT'
    })
    expect(byKey['linear:HIGH-OLD'].fields['mr.owner_block']).toBe("!1588 is shivan2418's MR")
    expect(byKey['linear:HIGH-NEW'].worktreeHint).toEqual({ linearIssue: 'HIGH-NEW' })
    expect(byKey['linear:HIGH-NEW'].fields['ticket.branch_exists']).toBe(true)
    expect(byKey['linear:NONE-OLD'].fields).toMatchObject({
      'ticket.branch_exists': false,
      'mr.owner_block': ''
    })
    expect(byKey['linear:URGENT'].fields).toMatchObject({
      'ticket.id': 'URGENT',
      'ticket.branch': 'web-1-urgent',
      'ticket.state_type': 'unstarted',
      'ticket.priority': 1,
      'ticket.team': 'WEB',
      'ticket.assignee': 'Nish',
      'ticket.workspace': 'ws1'
    })
    expect(byKey['linear:URGENT'].sortKeys).toEqual({
      priority: 1,
      waitingSince: Date.parse('2026-10-01T00:00:00Z')
    })
    const low = source(connector()).scope(byKey['linear:LOW'], M01, null)
    expect(low.ok ? null : low.reason).toBe('No branch name in Linear')
  })

  it.each([
    ['truncated', { truncated: true }],
    ['has more', { meta: { ...meta, hasMore: true } }],
    ['partial', { meta: { ...meta, partial: true } }],
    [
      'a workspace failed',
      {
        meta: {
          ...meta,
          workspaceErrors: [
            { workspace: { id: 'w', name: 'W' }, code: 'linear_timeout', message: 'slow' }
          ]
        }
      }
    ]
  ] as [string, Partial<LinearIssueListResult>][])(
    'refuses an incomplete listing: %s',
    async (_name, over) => {
      const linear = connector({ issues: LISTING, meta, ...over } as LinearIssueListResult)
      await expect(source(linear).list(context(), M01)).rejects.toThrow(
        'incomplete Linear listing, refusing to guess'
      )
    }
  )

  it('lists Linear once for every automation of a pass', async () => {
    const linear = connector()
    const pass = context()
    await source(linear).list(pass, M01)
    await source(linear).list(pass, { state_type: ['unstarted'] })
    expect(linear.listIssues).toHaveBeenCalledTimes(1)
    expect(linear.issue).toHaveBeenCalledTimes(5)
  })
})

describe('linearTicketSource: who and what is blocked', () => {
  it('lists every ticket when the assignee is a named non-viewer, and matches by display name', async () => {
    const emils = [
      { ...listed('URGENT', 'unstarted', 1), assignee: { id: 'u-emil', displayName: 'Emil' } },
      listed('LOW', 'unstarted', 4)
    ] as Listed[]
    const linear = {
      listIssues: vi.fn(async () => ({ issues: emils, meta: { ...meta, filter: 'all' } })),
      issue: vi.fn(async (id: string) => {
        const item = emils.find((i) => i.identifier === id) as Listed
        return detail(item, CREATED[id], BRANCH[id])
      })
    } as unknown as ReturnType<typeof connector>
    const people = {
      ...PEOPLE,
      people: PEOPLE.people.map((p) => (p.id === 'emil' ? { ...p, linear: 'Emil' } : p))
    }
    const where = { assignee: { people: ['emil'] } }
    const src = source(linear)
    const { items } = await src.list(context({ people }), where)
    expect(linear.listIssues).toHaveBeenCalledWith('all')
    const verdict = (key: string) => {
      const r = src.scope(items.find((i) => i.key === key) as Item, where, people)
      return r.ok ? null : r.reason
    }
    expect(verdict('linear:URGENT')).toBeNull()
    expect(verdict('linear:LOW')).toBe(
      'Assignee is Nish Sitapara; this automation looks at Emil Elgaard'
    )
  })

  it('blocks a ticket whose branch existence cannot be read, and not a clean absence', async () => {
    const failing: GitRunner = async () => {
      throw Object.assign(new Error('git timed out'), { code: 0, killed: true })
    }
    const src = linearTicketSource({
      linear: connector(),
      listWorktrees: async () => [],
      git: failing
    })
    const { items } = await src.list(context(), M01)
    const urgent = items.find((i) => i.key === 'linear:URGENT') as Item
    expect(urgent.fields['mr.owner_block']).toMatch(/^branch web-1-urgent unknown: git timed out/)
    expect(urgent.fields['ticket.branch_exists']).toBeNull()
  })

  it('a worktree ticket whose GitLab lookup fails is blocked and says why', async () => {
    const down = fakeGlab(() => new Error('gitlab down'))
    const broken = await source(connector()).list(sourceContext({}, down), M01)
    const old = broken.items.find((i) => i.key === 'linear:HIGH-OLD') as Item
    expect(old.fields['mr.owner_block']).toMatch(/unknown/i)
  })
})

describe('findTicketWorktree (sweep.py find_worktree)', () => {
  it('the ticket link wins, a same-branch worktree still matches, archived ones never', () => {
    const live = WORKTREES.filter((w) => !w.isArchived)
    expect(findTicketWorktree(live, 'URGENT', 'web-1-urgent')?.path).toBe('/wt/linked')
    expect(findTicketWorktree(live, 'HIGH-OLD', 'web-2-high-old')?.path).toBe('/wt/high-old')
    expect(findTicketWorktree(live, 'HIGH-NEW', 'web-3-high-new')).toBeNull()
  })
})
