import { describe, expect, it, vi } from 'vitest'
import type {
  LinearIssueListResult,
  LinearIssueSummary
} from '../../../../../shared/linear/agent-access'
import {
  classifyLinearError,
  linearError,
  linearMessage
} from '../../../../../main/linear/issue-context-errors'
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

  // A read-only look must never take git's optional locks in Nish's checkout (it would block his own git).
  it('reads whether a branch exists with git optional locks off', async () => {
    const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = []
    const recording: GitRunner = async (args, opts) => {
      calls.push({ args, env: opts?.env })
      throw Object.assign(new Error('exit 1'), { code: 1 })
    }
    const src = linearTicketSource({
      linear: connector(),
      listWorktrees: async () => [],
      git: recording
    })
    await src.list(context(), M01)
    const showRef = calls.filter((c) => c.args[0] === 'show-ref')
    expect(showRef.length).toBeGreaterThan(0)
    for (const call of showRef) {
      expect(call.env?.GIT_OPTIONAL_LOCKS).toBe('0')
    }
  })

  it('a worktree ticket whose GitLab lookup fails is blocked and says why', async () => {
    const down = fakeGlab(() => new Error('gitlab down'))
    const broken = await source(connector()).list(sourceContext({}, down), M01)
    const old = broken.items.find((i) => i.key === 'linear:HIGH-OLD') as Item
    expect(old.fields['mr.owner_block']).toMatch(/unknown/i)
  })
})

describe('linearTicketSource: the ids where.ids_from gave', () => {
  const START = {
    team: 'WEB',
    state_type: ['triage', 'backlog', 'unstarted', 'started'],
    has_branch: true
  }
  // WEB-1 urgent, WEB-2 high and older than WEB-3, WEB-4 done.
  const TICKETS = [
    detail(listed('WEB-3', 'started', 2), '2026-10-05T00:00:00Z', 'web-3-fix'),
    detail(listed('WEB-4', 'completed', 1), '2026-10-01T00:00:00Z', 'web-4-fix'),
    detail(listed('WEB-1', 'started', 1), '2026-10-09T00:00:00Z', 'web-1-fix'),
    detail(listed('WEB-2', 'started', 2), '2026-09-01T00:00:00Z', 'web-2-fix')
  ]
  // What Pilot's Linear read throws, wrapped as the issue client wraps a failed read (issue-context-client.ts).
  const linearThrows = (text: string) => {
    const raw = new Error(text)
    return linearError(classifyLinearError(raw), linearMessage(raw))
  }
  // A workspace's read of an identifier it doesn't have: Linear's own words, which classify as a network error.
  const MISS = () => linearThrows('Entity not found: Issue - Could not find referenced Issue.')
  // No signed-in workspace had it and none failed (resolveIssue).
  const NONE_HAD_IT = (id: string) =>
    linearError('linear_issue_not_found', `Linear issue ${id} was not found.`)
  const refuse = (): Promise<never> => Promise.reject(new Error('a source never writes'))
  const byId = (miss: (id: string) => Error = MISS) =>
    ({
      listIssues: vi.fn(async () => ({ issues: [], meta })),
      issue: vi.fn(async (id: string) => {
        const found = TICKETS.find((t) => t.identifier === id)
        if (!found) {
          throw miss(id)
        }
        return found
      }),
      create: refuse,
      comment: refuse,
      setState: refuse,
      attach: refuse
    }) satisfies LinearConnector

  it('reads only those tickets, by identifier and GET only, never the listing; open ones in the usual order', async () => {
    const linear = byId()
    const { items, warnings } = await source(linear).list(
      context({ ids: ['WEB-3', 'WEB-4', 'WEB-1', 'WEB-2'] }),
      START
    )
    expect(linear.listIssues).not.toHaveBeenCalled()
    expect(linear.issue.mock.calls).toEqual([['WEB-3'], ['WEB-4'], ['WEB-1'], ['WEB-2']])
    // WEB-4 is done, a state the where block leaves out: not listed, as a listing's closed tickets aren't
    expect(items.map((i) => i.key)).toEqual(['linear:WEB-1', 'linear:WEB-2', 'linear:WEB-3'])
    expect(warnings).toEqual([])
    expect(items[0].fields).toMatchObject({
      'ticket.id': 'WEB-1',
      'ticket.branch': 'web-1-fix',
      'ticket.workspace': null
    })
  })

  it('reads nothing for an empty set', async () => {
    const linear = byId()
    expect((await source(linear).list(context({ ids: [] }), START)).items).toEqual([])
    expect(linear.listIssues).not.toHaveBeenCalled()
    expect(linear.issue).not.toHaveBeenCalled()
  })

  it.each([
    ["Linear's Entity not found", MISS],
    ['no workspace having it', NONE_HAD_IT]
  ])(
    "skips an id Linear doesn't know (%s), with a warning, and checks the rest",
    async (_n, miss) => {
      const { items, warnings } = await source(byId(miss)).list(
        context({ ids: ['WEB-9', 'WEB-1'] }),
        START
      )
      expect(items.map((i) => i.key)).toEqual(['linear:WEB-1'])
      expect(warnings).toEqual(["WEB-9 isn't readable in Linear; skipped"])
    }
  )

  it('names the ids Linear has no such ticket for, so a fed one is dropped rather than kept', async () => {
    const listed = await source(byId(MISS)).list(context({ ids: ['WEB-9', 'WEB-1'] }), START)
    expect(listed.missing).toEqual(['WEB-9'])
  })

  it('skips an id it fails to read for any other reason, with a warning, and reads the rest; never fails the list', async () => {
    for (const thrown of [new Error('linear_timeout'), linearThrows('fetch failed')]) {
      const flaky = byId()
      flaky.issue.mockImplementation(async (id: string) => {
        if (id === 'WEB-9') {
          throw thrown
        }
        return byId().issue(id)
      })
      const listed = await source(flaky).list(context({ ids: ['WEB-9', 'WEB-1'] }), START)
      expect(listed.items.map((i) => i.key)).toEqual(['linear:WEB-1'])
      expect(listed.skipped).toEqual(['WEB-9'])
      expect(listed.missing).toEqual([])
      expect(listed.warnings.join('\n')).toContain("WEB-9 couldn't be read from Linear")
    }
  })

  it('fails the list on an id that is no Linear identifier (its own command printed it)', async () => {
    const linear = byId()
    await expect(source(linear).list(context({ ids: ['WEB-1', 'web 1'] }), START)).rejects.toThrow(
      `ids_from gave "web 1", which isn't a Linear identifier (like WEB-123)`
    )
    expect(linear.issue).not.toHaveBeenCalled()
  })

  it('still scopes what it read by the where block: an assignee clause no longer means an org-wide listing', async () => {
    const src = source(byId())
    const where = { ...START, assignee: { people: ['emil'] } }
    const { items } = await src.list(context({ ids: ['WEB-1'] }), where)
    const verdict = src.scope(items[0], where, PEOPLE)
    expect(verdict.ok ? null : verdict.reason).toBe(
      'Assignee is Nish Sitapara; this automation looks at Emil Elgaard'
    )
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
