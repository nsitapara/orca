import { describe, expect, it } from 'vitest'
import { NOW, PEOPLE, fakeGlab, sourceContext } from './__fixtures__/source-context'
import type { GitRunner } from './worktree-git'
import { eligibleWorktree, type WorktreeRecord } from './worktree-records'
import { worktreeSource } from './worktrees'

const DAY = 86_400_000
function rec(branch: string, over: Partial<WorktreeRecord> = {}): WorktreeRecord {
  return {
    id: `repo1::/wt/${branch}`,
    path: `/wt/${branch}`,
    branch,
    head: `${branch}-head`,
    isArchived: false,
    isMain: false,
    linkedLinearIssue: null,
    ...over
  }
}

describe('eligibleWorktree (gate.worktrees)', () => {
  it.each([
    ['a feature branch', rec('web-1-x'), true],
    ['the main checkout', rec('web-2-x', { isMain: true }), false],
    ['archived', rec('web-3-x', { isArchived: true }), false],
    ['dev', rec('dev'), false],
    ['main', rec('main'), false],
    ["a loop's own branch", rec('agent-loop/standards'), false],
    ['detached', rec('web-4-x', { branch: '' }), false],
    ['gone from disk', rec('web-5-gone'), false]
  ] as [string, WorktreeRecord, boolean][])('%s', (_name, w, want) => {
    expect(eligibleWorktree(w, (p) => !p.endsWith('gone'))).toBe(want)
  })
})

// git's own non-zero exit carries a numeric code; a runner failure (timeout, spawn) does not.
const exit1 = (message: string) => Object.assign(new Error(message), { code: 1 })

const envSeen: (string | undefined)[] = []
type FakeRepo = {
  head: string
  ancestors?: string[]
  log?: string
  mergeBase?: string
  fail?: string
}
function fakeGit(repos: Record<string, FakeRepo>): GitRunner {
  return async (args, { cwd, env }) => {
    const r = repos[cwd]
    envSeen.push(env?.GIT_OPTIONAL_LOCKS)
    if (!r || r.fail) {
      throw new Error(r?.fail ?? `no repo at ${cwd}`)
    }
    if (args.join(' ') === 'rev-parse HEAD') {
      return { stdout: `${r.head}\n` }
    }
    if (args[0] === 'merge-base' && args[1] === '--is-ancestor') {
      if (r.ancestors?.includes(args[2])) {
        return { stdout: '' }
      }
      throw exit1('exit 1')
    }
    if (args[0] === 'log') {
      return { stdout: r.log ?? '' }
    }
    if (args[0] === 'rev-parse' && args[1] === '--verify' && args[3] === 'origin/dev^{commit}') {
      return { stdout: 'ok\n' }
    }
    if (args[0] === 'merge-base') {
      return { stdout: `${r.mergeBase ?? 'base0000'}\n` }
    }
    throw exit1(`exit 1: git ${args.join(' ')}`)
  }
}
const log = (...commits: [string, number, string][]) =>
  commits.map(([sha, at, msg]) => `${sha}\u0000${at / 1000}\u0000${msg}\n\u001e\n`).join('')

const BRANCH_MRS: Record<string, unknown[]> = {
  'web-1-mine': [
    {
      iid: 1577,
      state: 'opened',
      web_url: 'https://gitlab/mr/1577',
      author: { username: 'nish8' },
      target_branch: 'dev'
    }
  ],
  'web-2-teammate': [
    {
      iid: 1588,
      state: 'opened',
      web_url: 'https://gitlab/mr/1588',
      author: { username: 'shivan2418' }
    }
  ]
}
const gitlab = fakeGlab((path) => {
  if (path === 'root:user') {
    return { username: 'nish8' }
  }
  const branch = /^merge_requests\?source_branch=([^&]+)&per_page=100&page=1$/.exec(path)
  if (branch) {
    return BRANCH_MRS[decodeURIComponent(branch[1])] ?? []
  }
  return path.endsWith('/approvals') ? {} : undefined
})

const records = [
  rec('web-1-mine'),
  rec('web-2-teammate'),
  rec('web-3-new'),
  rec('web-4-rewritten'),
  rec('web-5-broken'),
  rec('dev')
]
const git = fakeGit({
  '/wt/web-1-mine': {
    head: 'c2',
    ancestors: ['m1'],
    log: log(
      ['c2', NOW - DAY, 'own 2'],
      ['c1', NOW - 2 * DAY, 'fixes\n\nAgent-Loop: standards'],
      ['c0', NOW - 3 * DAY, 'own 1']
    )
  },
  '/wt/web-2-teammate': { head: 't1', ancestors: ['t0'], log: log(['t1', NOW - DAY, 'theirs']) },
  '/wt/web-3-new': { head: 'n1', log: log(['n1', NOW - 2 * DAY, 'fresh']) },
  '/wt/web-4-rewritten': { head: 'r2' },
  '/wt/web-5-broken': { head: 'x', fail: 'fatal: not a git repository' }
})
const markers = new Map([
  ['repo1::/wt/web-1-mine', 'm1'],
  ['repo1::/wt/web-2-teammate', 't0'],
  ['repo1::/wt/web-4-rewritten', 'old']
])
const source = worktreeSource({
  listWorktrees: async () => records,
  git,
  markers: () => markers,
  pathExists: () => true
})

describe('worktreeSource, an env folder', () => {
  it.each([
    ['is not an item', true, []],
    ['is an item', false, ['wt:repo1::/wt/web-1']]
  ])('a branch worktree at a path whose envFolder is %s', async (_n, isEnv, keys) => {
    const one = worktreeSource({
      listWorktrees: async () => [rec('web-1')],
      git: fakeGit({ '/wt/web-1': { head: 'c1' } }),
      markers: () => new Map(),
      pathExists: () => true,
      envFolder: () => isEnv
    })
    const { items } = await one.list(sourceContext({}, gitlab), {})
    expect(items.map((i) => i.key)).toEqual(keys)
  })
})

describe('worktreeSource', () => {
  it('03: own commits since the marker, first sights and rewrites baselined, teammates out', async () => {
    const where = {
      branch_owner: { people: ['nish'] },
      commits: { ignore_trailer: 'Agent-Loop: standards' }
    }
    const { items, warnings } = await source.list(sourceContext({}, gitlab), where)
    const rows = items.map((i) => {
      const scope = source.scope(i, where, PEOPLE)
      return [
        i.key,
        scope.ok ? 'in' : scope.reason,
        i.fields['item.baseline'],
        i.fields['worktree.new_commits']
      ]
    })
    expect(rows).toEqual([
      ['wt:repo1::/wt/web-1-mine', 'in', false, 2],
      ['wt:repo1::/wt/web-2-teammate', "!1588 is shivan2418's MR", false, 1],
      ['wt:repo1::/wt/web-3-new', 'in', true, 0],
      ['wt:repo1::/wt/web-4-rewritten', 'in', true, 0],
      [
        'wt:repo1::/wt/web-5-broken',
        "Couldn't read the branch's commits: fatal: not a git repository",
        false,
        null
      ]
    ])
    expect(warnings).toEqual([
      "web-5-broken: couldn't read its commits: fatal: not a git repository"
    ])
    expect(items[0].fields).toMatchObject({
      'worktree.head': 'c2',
      'worktree.at_head': 'repo1::/wt/web-1-mine@c2',
      'worktree.marker': 'm1',
      'worktree.since': 'm1',
      'worktree.waiting_since': NOW - 3 * DAY,
      'mr.iid': 1577,
      'mr.review_block': ''
    })
    expect(items[0].sortKeys.waitingSince).toBe(NOW - 3 * DAY)
    expect(items[0].worktreeHint).toEqual({
      id: 'repo1::/wt/web-1-mine',
      path: '/wt/web-1-mine',
      branch: 'web-1-mine'
    })
    expect(items[3].fields['worktree.rewritten']).toBe(true)
  })

  it('reads git with optional locks off, and a runner failure is a git_error, not a rewrite', async () => {
    const timeoutGit: GitRunner = async () => {
      throw new Error('git timed out after 30000ms')
    }
    const flaky = worktreeSource({
      listWorktrees: async () => [rec('web-1-mine')],
      git: timeoutGit,
      markers: () => markers,
      pathExists: () => true
    })
    const where = { commits: {} }
    const { items } = await flaky.list(sourceContext({}, gitlab), where)
    expect(items[0].fields).toMatchObject({
      'worktree.rewritten': null,
      'worktree.git_error': 'git timed out after 30000ms'
    })
    expect(flaky.scope(items[0], where, PEOPLE)).toMatchObject({ ok: false })
    expect(envSeen.length).toBeGreaterThan(0)
    expect(new Set(envSeen)).toEqual(new Set(['0']))
  })

  it('04: a first sight is tested against its base when its own work is recent', async () => {
    const where = { commits: { first_sight: 'test_recent' } }
    const { items } = await source.list(sourceContext({}, gitlab), where)
    const fresh = items.find((i) => i.key === 'wt:repo1::/wt/web-3-new')
    expect(fresh?.fields).toMatchObject({
      'item.baseline': false,
      'worktree.first_sight': true,
      'worktree.base_ref': 'origin/dev',
      'worktree.since': 'base0000',
      'worktree.new_commits': 1
    })
    const old = await source.list(sourceContext({ now: NOW + 8 * DAY }, gitlab), where)
    expect(
      old.items.find((i) => i.key === 'wt:repo1::/wt/web-3-new')?.fields['item.baseline']
    ).toBe(true)
  })
})
