import { execFile, execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
function commit(cwd: string, message: string): string {
  clock += 3600
  sh(cwd, 'commit', '--allow-empty', '-q', '-m', message)
  return sh(cwd, 'rev-parse', 'HEAD')
}

// main: base ─ dev-work                 feature: base ─ own-1 ─ standards-fix ─ uiqa-fix ─ merge(main) ─ own-2
let repo = ''
const sha: Record<string, string> = {}
beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'pilot-wt-git-'))
  sh(repo, 'init', '-q', '-b', 'main')
  sha.base = commit(repo, 'base')
  sh(repo, 'checkout', '-q', '-b', 'feature')
  sha.own1 = commit(repo, 'own 1')
  sha.standards = commit(repo, 'review fixes\n\nAgent-Loop: standards\nAgent-Round: 1')
  sha.uiqa = commit(repo, 'fix(ui): button\n\nAgent-Loop: ui-qa')
  sh(repo, 'checkout', '-q', 'main')
  sha.devWork = commit(repo, 'dev work')
  sh(repo, 'checkout', '-q', 'feature')
  clock += 3600
  sh(repo, 'merge', '-q', '--no-ff', '-m', 'merge main', 'main')
  sha.own2 = commit(repo, 'own 2')
})

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

  it('parses records with any message, keeping newest first', () => {
    const out = 'a\u00001\u0000one\n\u001e\nb\u00002\u0000two\n\nAgent-Loop: x\n\u001e\n'
    expect(parseOwnCommits(out, null)).toEqual([{ sha: 'a', at: 1000 }])
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
    ['a dev commit merged in', () => sha.devWork, true]
  ])('%s', async (_name, of, want) => {
    expect(await isAncestor(git, repo, of(), 'HEAD')).toBe(want)
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
})
