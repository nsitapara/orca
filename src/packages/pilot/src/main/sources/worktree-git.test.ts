import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  baseRef,
  commitFacts,
  isAncestor,
  ownCommits,
  parseOwnCommits,
  type GitRunner
} from './worktree-git'

const run = promisify(execFile)
const git: GitRunner = (args, opts) =>
  run('git', args, { cwd: opts.cwd, env: { ...process.env, ...opts.env } })

const T0 = 1_760_000_000 // seconds; each commit is an hour after the previous one
let clock = T0
function sh(cwd: string, ...args: string[]): string {
  const at = `${clock} +0000`
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Pilot',
      '-c',
      'user.email=pilot@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args
    ],
    { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } }
  ).trim()
}
function commit(cwd: string, message: string, file?: string): string {
  clock += 3600
  if (file) {
    mkdirSync(join(cwd, dirname(file)), { recursive: true })
    writeFileSync(join(cwd, file), message)
    sh(cwd, 'add', file)
  }
  sh(cwd, 'commit', '--allow-empty', '-q', '-m', message)
  return sh(cwd, 'rev-parse', 'HEAD')
}

// main: base ─ dev-work                 feature: base ─ own-1 ─ standards-fix ─ uiqa-fix ─ merge(main) ─ own-2
// own-1 and dev-work change apps/, own-2 changes docs/; the rest change nothing.
let repo = ''
const sha: Record<string, string> = {}
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'pilot-wt-git-'))
  sh(repo, 'init', '-q', '-b', 'main')
  sha.base = commit(repo, 'base')
  sh(repo, 'checkout', '-q', '-b', 'feature')
  sha.own1 = commit(repo, 'own 1', 'apps/staff/a.tsx')
  sha.standards = commit(repo, 'review fixes\n\nAgent-Loop: standards\nAgent-Round: 1')
  sha.uiqa = commit(repo, 'fix(ui): button\n\nAgent-Loop: ui-qa')
  sh(repo, 'checkout', '-q', 'main')
  sha.devWork = commit(repo, 'dev work', 'apps/staff/dev.tsx')
  sh(repo, 'checkout', '-q', 'feature')
  clock += 3600
  sh(repo, 'merge', '-q', '--no-ff', '-m', 'merge main', 'main')
  sha.own2 = commit(repo, 'own 2', 'docs/notes.md')
  // A commit on a side branch: it exists in the clone but is not an ancestor of HEAD.
  sh(repo, 'checkout', '-q', '-b', 'side', sha.base)
  sha.side = commit(repo, 'side work')
  sh(repo, 'checkout', '-q', 'feature')
})

const timeout = (): GitRunner => async () => {
  throw Object.assign(new Error('git timed out after 30000ms'), { name: 'GitCommandTimeoutError' })
}
// A killed child: node reports the exit code 0 (or the signal) beside `killed`, never git's own 1/128.
const killedWithCodeZero = (): GitRunner => async () => {
  throw Object.assign(new Error('git timed out'), { code: 0, killed: true, signal: 'SIGTERM' })
}
const spawnFailure = (): GitRunner => async () => {
  throw Object.assign(new Error('spawn git ENOENT'), { code: 'ENOENT' })
}

describe('ownCommits (gate.new_commits / due.own_commits)', () => {
  it.each([
    [
      '03 ignores only its own loop',
      'Agent-Loop: standards',
      ['own 2', 'fix(ui): button', 'own 1']
    ],
    ['04 ignores every loop', null, ['own 2', 'own 1']]
  ] as [string, string | null, string[]][])(
    '%s; merges and the merged-in dev work never count',
    async (_name, ignoreTrailer, subjects) => {
      const commits = await ownCommits(git, repo, sha.base, ignoreTrailer)
      const bySha = Object.fromEntries(Object.entries(sha).map(([k, v]) => [v, k]))
      const named: Record<string, string> = {
        own2: 'own 2',
        own1: 'own 1',
        uiqa: 'fix(ui): button'
      }
      expect(commits.map((c) => named[bySha[c.sha]])).toEqual(subjects)
      expect(commits[0].at).toBeGreaterThan(commits.at(-1)?.at ?? 0)
    }
  )

  it.each<[string, string[], string[]]>([
    ['portal code', ['apps/', 'packages/', 'api/'], ['own1']],
    ['docs', ['docs/'], ['own2']],
    ['a folder nothing changed', ['infra/'], []]
  ])(
    'with paths (%s), only an own commit that changes one counts, never merged-in dev work',
    async (_name, paths, names) => {
      const commits = await ownCommits(git, repo, sha.base, null, paths)
      const bySha = Object.fromEntries(Object.entries(sha).map(([k, v]) => [v, k]))
      expect(commits.map((c) => bySha[c.sha])).toEqual(names)
    }
  )

  it('parses records with any message, keeping newest first', () => {
    const out = 'a\u00001\u0000one\n\u001e\nb\u00002\u0000two\n\nAgent-Loop: x\n\u001e\n'
    expect(parseOwnCommits(out, null)).toEqual([{ sha: 'a', at: 1000 }])
  })

  it('throws on a commit time that is not a number', () => {
    expect(() => parseOwnCommits('a\u0000soon\u0000msg\n\u001e\n', null)).toThrow('Unreadable')
  })

  it('matches the whole trailer line when one is configured, any Agent-Loop: line when none is (R-6)', () => {
    const record = (sha: string, message: string) => `${sha}\u00001\u0000${message}\n\u001e\n`
    const out =
      record('a', 'one\n\nAgent-Loop: standards-extra') +
      record('b', 'two\n\nAgent-Loop: standards') +
      record('c', 'three')
    expect(parseOwnCommits(out, 'Agent-Loop: standards').map((c) => c.sha)).toEqual(['a', 'c'])
    expect(parseOwnCommits(out, null).map((c) => c.sha)).toEqual(['c'])
  })
})

describe('isAncestor (gate.evaluate rewrite rule)', () => {
  it.each([
    ['an earlier commit', () => sha.own1, true],
    ['a sha this clone does not have', () => 'deadbeef'.repeat(5), false],
    ['a dev commit merged in', () => sha.devWork, true],
    ['a side-branch commit (git exits 1)', () => sha.side, false]
  ])('%s', async (_name, of, want) => {
    expect(await isAncestor(git, repo, of(), 'HEAD')).toBe(want)
  })
})

describe('isAncestor fails closed on anything but gits own exit', () => {
  it('git exit 128 (a missing object) is not an ancestor', async () => {
    await expect(isAncestor(git, repo, 'deadbeef'.repeat(5), 'HEAD')).resolves.toBe(false)
  })

  it.each([
    ['a timeout', timeout()],
    ['a spawn error', spawnFailure()],
    ['a killed child with numeric code 0', killedWithCodeZero()]
  ])('%s is an error, not a rewrite', async (_name, runner) => {
    await expect(isAncestor(runner, repo, sha.own1, 'HEAD')).rejects.toThrow()
    await expect(
      commitFacts(runner, repo, 'feature', sha.own1, null, 'baseline', null)
    ).rejects.toThrow()
    await expect(baseRef(runner, repo, 'feature', 'main')).rejects.toThrow()
  })
})

describe('git reads run with optional locks off', () => {
  it('passes GIT_OPTIONAL_LOCKS=0 on every call', async () => {
    const seen: (string | undefined)[] = []
    const recorder: GitRunner = (args, opts) => {
      seen.push(opts.env?.GIT_OPTIONAL_LOCKS)
      return git(args, opts)
    }
    await commitFacts(recorder, repo, 'feature', null, null, 'test_recent', 'main')
    await commitFacts(recorder, repo, 'feature', sha.own1, null, 'baseline', null)
    await baseRef(recorder, repo, 'feature', null)
    expect(seen.length).toBeGreaterThan(5)
    expect(new Set(seen)).toEqual(new Set(['0']))
  })
})

describe('baseRef (due.base_ref)', () => {
  it.each([
    ["the MR's target when it exists locally", 'main', null, 'main'],
    ['branch.<name>.base when there is no MR', null, 'refs/heads/main', 'main'],
    ['origin/dev when nothing else resolves', 'nope', null, 'origin/dev']
  ])('%s', async (_name, target, recorded, want) => {
    if (recorded) {
      sh(repo, 'config', 'branch.feature.base', recorded)
    }
    expect(await baseRef(git, repo, 'feature', target)).toBe(want)
    try {
      sh(repo, 'config', '--unset-all', 'branch.feature.base')
    } catch {
      // exit 5: the key wasn't set in this case
    }
  })
})

describe('commitFacts', () => {
  it('counts own commits since a valid marker', async () => {
    const facts = await commitFacts(git, repo, 'feature', sha.own1, null, 'baseline', null)
    expect(facts).toMatchObject({
      head: sha.own2,
      rewritten: false,
      firstSight: false,
      since: sha.own1
    })
    expect(facts.commits.map((c) => c.sha)).toEqual([sha.own2])
  })

  it.each([
    ['03 (baseline): no marker reads no base', null, 'baseline', true, false, null, 0],
    ['03 (baseline): a rewritten marker', 'deadbeef'.repeat(5), 'baseline', true, true, null, 0],
    [
      '04 (test_recent): the whole branch against its base',
      null,
      'test_recent',
      true,
      false,
      'main',
      2
    ]
  ] as const)('%s', async (_name, marker, mode, firstSight, rewritten, base, count) => {
    const facts = await commitFacts(git, repo, 'feature', marker, null, mode, 'main')
    expect([facts.firstSight, facts.rewritten, facts.baseRef, facts.commits.length]).toEqual([
      firstSight,
      rewritten,
      base,
      count
    ])
    if (mode === 'baseline') {
      expect(facts.since).toBe(facts.head)
    }
  })

  it('counts only commits under paths, from the marker and at a first sight', async () => {
    const fromMarker = await commitFacts(git, repo, 'feature', sha.own1, null, 'baseline', null, [
      'apps/'
    ])
    const whole = await commitFacts(git, repo, 'feature', null, null, 'test_recent', 'main', [
      'apps/'
    ])
    expect([fromMarker.commits.length, whole.commits.map((c) => c.sha)]).toEqual([0, [sha.own1]])
  })
})
