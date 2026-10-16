import { describe, expect, it } from 'vitest'
import {
  fixtureBusyReads,
  fixtureGit,
  fixtureGitOperation,
  fixtureGlab,
  fixtureMisses,
  fixturePass,
  fixtureQuota,
  fixtureRuntime,
  NotInFixture,
  normalizeApiPath,
  type ParityFixture
} from './fixture'
import { frozenOldSide } from './old-side'

const marker = (path: string, name: string, out: string) => ({
  argv: ['git', '-C', path, 'rev-parse', '--git-path', name],
  code: 0,
  stdout: `${out}\n`,
  stderr: ''
})
const F: ParityFixture = {
  job: 't',
  case: 't',
  recordedAt: '',
  now: 1,
  repo: { id: 'r1', path: '/main', name: 'web-platform', project: 'g/web', host: 'gitlab.com' },
  reads: [
    {
      argv: ['glab', 'api', '--hostname', 'gitlab.com', 'user'],
      code: 0,
      json: { username: 'nish8' }
    },
    {
      argv: [
        'glab',
        'api',
        '--hostname',
        'gitlab.com',
        'projects/g%2Fweb/merge_requests?state=opened&author_username=nish8&per_page=100&page=1'
      ],
      code: 0,
      json: [{ iid: 1 }]
    },
    {
      argv: ['glab', 'api', '--hostname', 'gitlab.com', 'projects/g%2Fweb/merge_requests/1'],
      code: 0,
      stdout: '{"iid":1}',
      stderr: ''
    },
    {
      argv: ['orca', 'worktree', 'list', '--json'],
      code: 0,
      json: {
        ok: true,
        result: {
          worktrees: [
            {
              id: 'r1::/wt/a',
              repoId: 'r1',
              path: '/wt/a',
              branch: 'refs/heads/a',
              isArchived: false
            },
            {
              id: 'r1::/wt/old',
              repoId: 'r1',
              path: '/wt/old',
              branch: 'refs/heads/old',
              isArchived: true
            },
            { id: 'r2::/x', repoId: 'r2', path: '/x', branch: 'refs/heads/x', isArchived: false }
          ]
        }
      }
    },
    marker('/wt/a', 'MERGE_HEAD', '.git/MERGE_HEAD'),
    marker('/wt/a', 'rebase-merge', '/gitdirs/a/rebase-merge')
  ],
  state: {},
  exists: { '/wt/a/.git/MERGE_HEAD': false, '/gitdirs/a/rebase-merge': true }
}

describe('normalizeApiPath', () => {
  it.each([
    [
      'merge_requests?state=opened&author_username=nish8&per_page=100&page=1',
      'merge_requests?author_username=nish8&per_page=100&state=opened'
    ],
    [
      'merge_requests?state=opened&per_page=100&page=2',
      'merge_requests?page=2&per_page=100&state=opened'
    ],
    ['merge_requests/1', 'merge_requests/1']
  ])('%s', (path, normal) => expect(normalizeApiPath(path)).toBe(normal))
})

describe('fixtureGlab', () => {
  it("answers Pilot's GETs from the old side's reads, and names one it lacks", async () => {
    const api = fixtureGlab(F)
    expect(await api.get('merge_requests?state=opened&author_username=nish8&per_page=100')).toEqual(
      [{ iid: 1 }]
    )
    expect(await api.get('merge_requests/1')).toEqual({ iid: 1 })
    await expect(api.get('merge_requests/2')).rejects.toThrow(NotInFixture)
  })

  it('answers GETs outside the project (getRoot) the same way, and names one it lacks', async () => {
    const api = fixtureGlab(F)
    expect(await api.getRoot('user')).toEqual({ username: 'nish8' })
    await expect(api.getRoot('users')).rejects.toThrow(NotInFixture)
  })

  it("serves a pass's GitLab client from the fixture, so Pilot reads through its own per-pass memo", async () => {
    const api = await fixturePass(F).gitlab('/main')
    expect(await api.get('merge_requests/1')).toEqual({ iid: 1 })
    expect(await api.getRoot?.('user')).toEqual({ username: 'nish8' })
  })
})

describe('fixtureRuntime', () => {
  it("lists the repo's live worktrees only", async () => {
    const listed = await fixtureRuntime(F).listManagedWorktrees('id:r1')
    expect(listed.worktrees.map((w) => w.git.path)).toEqual(['/wt/a'])
  })
})

describe('fixtureGitOperation', () => {
  it('names the first marker that exists, and refuses a worktree the old side never checked', async () => {
    const op = fixtureGitOperation(F)
    expect(await op('/wt/a')).toBe('rebase')
    await expect(op('/wt/b')).rejects.toThrow(NotInFixture)
  })
})

describe('fixtureMisses', () => {
  it('keeps every read the fixture lacked, once each, even when the caller swallowed the error', async () => {
    const f: ParityFixture = { ...F }
    await fixtureGlab(f)
      .get('merge_requests/2')
      .catch(() => null)
    await fixtureGlab(f)
      .get('merge_requests/2')
      .catch(() => null)
    await fixtureGitOperation(f)('/wt/b').catch(() => null)
    expect(fixtureMisses(f)).toEqual([
      'GET projects/g%2Fweb/merge_requests/2',
      'git -C /wt/b rev-parse --git-path MERGE_HEAD'
    ])
  })

  it('fails a read the old side saw fail the same way, without counting it as a miss', async () => {
    const failed = {
      argv: ['git', '-C', '/wt/c', 'status', '--porcelain'],
      code: 128,
      stdout: '',
      stderr: 'fatal: not a git repository'
    }
    const f: ParityFixture = { ...F, reads: [...F.reads, failed] }
    await expect(fixtureGit(f)(['status', '--porcelain=v1'], { cwd: '/wt/c' })).rejects.toThrow(
      'fatal: not a git repository'
    )
    expect(fixtureMisses(f)).toEqual([])
  })
})

describe('fixtureQuota', () => {
  it("serves Claude's saved reading from state, else from the case's quota field", () => {
    expect(
      fixtureQuota({ ...F, state: { 'quota/claude.json': { weekly: 61, session: 38 } } }, 'claude')
    ).toEqual({ weekly: 61, session: 38 })
    expect(
      fixtureQuota({ ...F, quota: { claude: { weekly: 95, session: 40 } } }, 'claude')
    ).toEqual({ weekly: 95, session: 40 })
  })

  it('reads a case with no saved reading as unknown, for either agent', () => {
    expect(fixtureQuota(F, 'claude')).toEqual({ weekly: null, session: null })
    expect(fixtureQuota(F, 'codex')).toEqual({ weekly: null, session: null })
  })
})

describe('fixtureQuota (Codex)', () => {
  const reading = (state: Record<string, unknown>, agent: 'claude' | 'codex') =>
    fixtureQuota({ ...F, state }, agent)

  it("serves Codex's saved raw answer through Task 18's reader", () => {
    const codex = {
      ordinaryUsageAllowed: true,
      rateLimits: {
        primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 9_999_999_999 },
        secondary: { usedPercent: 90, windowDurationMins: 10080, resetsAt: 9_999_999_999 },
        rateLimitReachedType: null
      }
    }
    expect(reading({ 'quota/codex-rate-limits.json': codex }, 'codex')).toEqual({
      weekly: 90,
      session: 40
    })
  })

  it('reads an unreadable Codex answer (null) as unknown', () => {
    expect(reading({ 'quota/codex-rate-limits.json': null }, 'codex')).toEqual({
      weekly: null,
      session: null
    })
  })
})

describe('fixtureBusyReads', () => {
  const recorded = (argv: string[], result: unknown) => ({
    argv: ['orca', ...argv, '--json'],
    code: 0,
    json: { ok: true, result }
  })

  it('answers the draft, agent-state and idle-wait reads from the recording', async () => {
    const f: ParityFixture = {
      ...F,
      reads: [
        recorded(['terminal', 'read', '--terminal', 't1'], { terminal: { draft: 'hi' } }),
        recorded(['worktree', 'ps', '--limit', '1000'], {
          worktrees: [{ agents: [{ paneKey: 'a:b', state: 'working' }] }]
        }),
        recorded(
          ['terminal', 'wait', '--terminal', 't1', '--for', 'tui-idle', '--timeout-ms', '1500'],
          { wait: { satisfied: false } }
        )
      ]
    }
    const reads = fixtureBusyReads(f)
    expect(await reads.draft('t1')).toBe('hi')
    expect((await reads.agentStates()).get('a:b')).toBe('working')
    expect(await reads.tabBusy('t1')).toBe(true)
  })

  it('an unrecorded read is a miss, not an idle answer', async () => {
    const f: ParityFixture = { ...F, reads: [] }
    await expect(fixtureBusyReads(f).draft('t1')).rejects.toBeInstanceOf(NotInFixture)
    expect(fixtureMisses(f)).toEqual(['orca terminal read --terminal t1 --json'])
  })
})

describe('frozenOldSide', () => {
  it("returns a case's frozen old side, and fails (never skips) a case without one", () => {
    const old = {
      from: 'test',
      decisions: [{ key: 'mr:1', label: '!1', decision: 'ask', reason: '' }]
    }
    expect(frozenOldSide({ ...F, old })).toBe(old)
    expect(() => frozenOldSide(F)).toThrow('t/t has no frozen old side')
  })
})
