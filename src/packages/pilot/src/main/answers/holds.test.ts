import { describe, expect, it, vi } from 'vitest'
import { FREE_HOLDS } from './__fixtures__/holds'
import { gitInFlight, hold, passActivity, quotaHold, worktreeHold, type HoldDeps } from './holds'

const h = (holdReason: string, holdDetail: string) => ({ holdReason, holdDetail })

describe('hold', () => {
  it('keeps a code and plain words, as the two queue fields', () => {
    expect(hold('typing', 'someone is typing in Claude · CI fix')).toEqual(
      h('typing', 'someone is typing in Claude · CI fix')
    )
  })
})

describe('worktreeHold', () => {
  it.each<[string, Partial<HoldDeps>, ReturnType<typeof h> | null]>([
    ['nothing going on', {}, null],
    ['no worktree', { exists: () => false }, h('no_worktree', 'no worktree for this branch')],
    [
      'a Pilot run there',
      { runsIn: () => [{ id: 'review-1' }] },
      h('worktree_busy', 'run review-1 is working there')
    ],
    [
      'uncommitted changes',
      { inFlight: async () => 'uncommitted changes' },
      h('in_flight', 'uncommitted changes')
    ],
    [
      'git unreadable',
      {
        inFlight: async () => {
          throw new Error('not a git repository')
        }
      },
      h('in_flight', 'git could not be read: not a git repository')
    ],
    [
      'someone typing',
      { activity: async () => ({ typing: true, reason: 'someone is typing in zsh' }) },
      h('typing', 'someone is typing in zsh')
    ],
    [
      'an agent asking',
      { activity: async () => ({ typing: false, reason: 'Claude is asking for input' }) },
      h('worktree_busy', 'Claude is asking for input')
    ],
    [
      'terminals unreadable',
      {
        activity: async () => {
          throw new Error('runtime not ready')
        }
      },
      h('worktree_busy', 'its terminals could not be read: runtime not ready')
    ]
  ])('%s', async (_name, change, expected) => {
    expect(await worktreeHold('/wt', { ...FREE_HOLDS, ...change })).toEqual(expected)
  })

  it('never holds a job-wide card', async () => {
    expect(await worktreeHold(null, { ...FREE_HOLDS, exists: () => false })).toBeNull()
  })
})

describe("gitInFlight (gate.py in_flight, over Task 5a's git facts)", () => {
  const facts = (counts: { dirty: number; untracked: number }, operation: string | null) => ({
    gitStatus: async () => counts,
    gitOperation: async () => operation
  })
  it.each([
    ['a clean worktree', { dirty: 0, untracked: 0 }, null, null],
    ['an edited file', { dirty: 1, untracked: 0 }, null, 'uncommitted changes'],
    ['an untracked file', { dirty: 0, untracked: 2 }, null, 'uncommitted changes'],
    ['a merge in progress', { dirty: 0, untracked: 0 }, 'merge', 'merge in progress'],
    ['a rebase in progress', { dirty: 0, untracked: 0 }, 'rebase', 'rebase in progress']
  ])('%s', async (_name, counts, operation, expected) => {
    expect(await gitInFlight(facts(counts, operation))('/wt')).toBe(expected)
  })
})

describe('passActivity', () => {
  function runtime(draft: string) {
    return {
      listTerminals: vi.fn(async () => ({
        truncated: false,
        totalCount: 1,
        terminals: [
          {
            handle: 't1',
            title: 'Claude · CI fix',
            connected: true,
            agentIdentity: 'claude',
            worktreePath: '/wt',
            tabId: 't1',
            leafId: 'leaf'
          }
        ]
      })),
      readTerminal: vi.fn(async () => ({ tail: [], draft })),
      getWorktreePs: vi.fn(async () => ({ truncated: false, totalCount: 0, worktrees: [] })),
      waitForTerminal: vi.fn(async () => ({ satisfied: true })),
      showTerminal: vi.fn(async () => ({ orphaned: false }))
    }
  }

  it('reports someone typing in an agent tab of the worktree, listing terminals once per pass', async () => {
    const rt = runtime('push it')
    const activity = passActivity(rt as never)
    expect(await activity('/wt')).toEqual({
      typing: true,
      reason: 'someone is typing in Claude · CI fix'
    })
    expect(await activity('/other')).toBeNull()
    expect(rt.listTerminals).toHaveBeenCalledTimes(1)
  })

  it('reports an idle worktree as null', async () => {
    expect(await passActivity(runtime('') as never)('/wt')).toBeNull()
  })

  it("fails closed: a terminal list that can't be read is passed on as a throw (a hold)", async () => {
    const rt = runtime('')
    rt.listTerminals.mockRejectedValueOnce(new Error('runtime not ready'))
    const holds = { ...FREE_HOLDS, activity: passActivity(rt as never) }
    expect(await worktreeHold('/wt', holds)).toEqual(
      h('worktree_busy', 'its terminals could not be read: runtime not ready')
    )
  })
})

describe('quotaHold', () => {
  it.each([
    [{ weekly: 89, session: 94 }, null],
    [{ weekly: null, session: null }, null],
    [
      { weekly: 92.4, session: 10 },
      h('quota', 'claude weekly limit at 92% (automations stop at 90%)')
    ],
    [
      { weekly: 10, session: 95 },
      h('quota', 'claude session limit at 95% (automations stop at 95%)')
    ]
  ])('%j', (reading, expected) => expect(quotaHold('claude', reading)).toEqual(expected))
})
