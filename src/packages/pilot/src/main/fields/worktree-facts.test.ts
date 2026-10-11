import { describe, expect, it, vi } from 'vitest'
import type { Item } from '../sources/types'
import {
  worktreeFacts,
  worktreeFor,
  type WorktreeFactDeps,
  type WorktreeInfo
} from './worktree-facts'

const list: WorktreeInfo[] = [
  { id: 'r::/repo', path: '/repo', branch: 'dev', head: 'h0', linkedLinearIssue: null },
  { id: 'r::/wt/a', path: '/wt/a', branch: 'web-1-a', head: 'h1', linkedLinearIssue: 'WEB-2118' },
  { id: 'r::/wt/b', path: '/wt/b', branch: 'feature/b', head: 'h2', linkedLinearIssue: null }
]

const itemOf = (kind: Item['kind'], worktreeHint: Item['worktreeHint']): Item => ({
  kind,
  key: 'k',
  label: 'k',
  fields: {},
  worktreeHint,
  sortKeys: { waitingSince: null, priority: null }
})

describe('worktreeFor', () => {
  it.each<[string, Item, string | null]>([
    ['by id', itemOf('worktree', { id: 'r::/wt/b' }), '/wt/b'],
    ['by path', itemOf('merge_request', { path: '/wt/a' }), '/wt/a'],
    ['by branch', itemOf('merge_request', { branch: 'feature/b' }), '/wt/b'],
    [
      'by branch given as refs/heads/…',
      itemOf('merge_request', { branch: 'refs/heads/web-1-a' }),
      '/wt/a'
    ],
    [
      'by linked Linear issue, any case',
      itemOf('linear_ticket', { linearIssue: 'web-2118' }),
      '/wt/a'
    ],
    ["a run-once item: the repo's main checkout", itemOf('repo', null), '/repo'],
    ['an unknown branch', itemOf('merge_request', { branch: 'gone' }), null],
    ['no hint', itemOf('pipeline', null), null]
  ])('%s', (_name, subject, path) => {
    expect(worktreeFor(subject, list, '/repo')?.path ?? null).toBe(path)
  })
})

function deps(over: Partial<WorktreeFactDeps> = {}): WorktreeFactDeps {
  return {
    listWorktrees: async () => list,
    gitStatus: async () => ({ dirty: 1, untracked: 2 }),
    gitOperation: async () => null,
    automationSessions: () => [],
    anySessions: () => [],
    terminalAlive: async () => false,
    agentTerminals: async () => [],
    paneState: () => 'idle',
    terminalDraft: async () => '',
    ...over
  }
}

const boom = async (): Promise<never> => {
  throw new Error('boom')
}
const wt = list[1]

describe('worktreeFacts', () => {
  it('splits tracked and untracked changes and carries id, branch, head and the agents', async () => {
    const activity = new Map([['/wt/a', { state: 'working' as const, typing: true }]])
    expect(await worktreeFacts(wt, 'ci', activity, deps())).toEqual({
      'worktree.path': '/wt/a',
      'worktree.id': 'r::/wt/a',
      'worktree.branch': 'web-1-a',
      'worktree.head': 'h1',
      'worktree.dirty_count': 1,
      'worktree.untracked_count': 2,
      'worktree.git_operation': null,
      'worktree.agent_state': 'working',
      'worktree.typing': true,
      'session.open_from_automation': false,
      'session.open_any': false
    })
  })

  it('leaves facts it cannot read unknown, never passing', async () => {
    const broken = deps({
      gitStatus: boom,
      gitOperation: boom,
      anySessions: () => {
        throw new Error('store closed')
      }
    })
    const facts = await worktreeFacts(wt, 'ci', null, broken)
    expect(facts['worktree.dirty_count']).toBeNull()
    expect(facts['worktree.untracked_count']).toBeNull()
    expect(facts).not.toHaveProperty('worktree.git_operation')
    expect(facts).not.toHaveProperty('session.open_any')
    expect(facts['worktree.agent_state']).toBeNull()
    expect(facts['worktree.typing']).toBeNull()
  })

  it("counts every automation's open tabs for session.open_any and only this one's for open_from_automation", async () => {
    const terminalAlive = vi.fn(async (handle: string) => handle === 'open')
    const facts = await worktreeFacts(
      wt,
      'ci',
      new Map(),
      deps({
        automationSessions: () => [{ active: false, handle: 'closed', paneKey: null }],
        anySessions: () => [{ active: false, handle: 'open', paneKey: 'p' }],
        terminalAlive
      })
    )
    expect([facts['session.open_from_automation'], facts['session.open_any']]).toEqual([
      false,
      true
    ])
  })

  it('reads a worktree with no agent tabs as idle and nobody typing', async () => {
    const facts = await worktreeFacts(wt, 'ci', new Map(), deps())
    expect([facts['worktree.agent_state'], facts['worktree.typing']]).toEqual(['idle', false])
  })
})
