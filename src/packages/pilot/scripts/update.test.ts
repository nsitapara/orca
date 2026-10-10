import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './run.mjs'
// @ts-expect-error -- .mjs script without type declarations
import { planUpdate, runSteps } from './update.mjs'

type Step = { title: string; cmd: string; args: string[] }

describe('planUpdate', () => {
  it('syncs main from upstream, merges it into pilot, then verifies', () => {
    expect(planUpdate({ push: false, build: false }).map((s: Step) => s.title)).toEqual([
      'Check the working tree is clean',
      'Fetch upstream and origin',
      'Fast-forward main to upstream/main',
      'Merge main into pilot',
      'Install dependencies',
      'Check Pilot hooks',
      'Build workspace packages',
      'Typecheck',
      'Run Pilot tests'
    ])
  })

  it('pushes only when asked', () => {
    const titles = planUpdate({ push: true, build: false }).map((s: Step) => s.title)
    expect(titles).toContain('Push main and pilot to origin')
    const off = planUpdate({ push: false, build: false }).map((s: Step) => s.title)
    expect(off).not.toContain('Push main and pilot to origin')
  })

  it('builds the app last when asked', () => {
    const steps = planUpdate({ push: false, build: true })
    expect(steps.at(-1)?.title).toBe('Build Pilot.app')
  })
})

function git(cwd: string, ...args: string[]): string {
  const r = run('git', args, { cwd })
  if (r.code !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  }
  return r.stdout.trim()
}

function commitFile(cwd: string, name: string): void {
  writeFileSync(join(cwd, name), name)
  git(cwd, 'add', name)
  git(cwd, 'commit', '-m', name)
}

function configure(cwd: string): void {
  git(cwd, 'config', 'user.email', 't@example.com')
  git(cwd, 'config', 'user.name', 'T')
  git(cwd, 'config', 'commit.gpgsign', 'false')
}

// A bare upstream, an origin copy of it, and a work clone with main and pilot.
function fixture(): { work: string } {
  const root = mkdtempSync(join(tmpdir(), 'pilot-update-'))
  const upstream = join(root, 'upstream.git')
  const origin = join(root, 'origin.git')
  const seed = join(root, 'seed')
  const work = join(root, 'work')
  git(root, 'init', '--bare', '-b', 'main', upstream)
  git(root, 'clone', upstream, seed)
  configure(seed)
  git(seed, 'switch', '-C', 'main')
  commitFile(seed, 'base.txt')
  git(seed, 'push', 'origin', 'main')
  git(root, 'clone', '--bare', upstream, origin)
  git(root, 'clone', origin, work)
  configure(work)
  git(work, 'remote', 'add', 'upstream', upstream)
  git(work, 'switch', '-c', 'pilot')
  commitFile(work, 'pilot.txt')
  commitFile(seed, 'upstream-new.txt')
  git(seed, 'push', 'origin', 'main')
  return { work }
}

const GIT_TITLES = [
  'Check the working tree is clean',
  'Fetch upstream and origin',
  'Fast-forward main to upstream/main',
  'Merge main into pilot'
]

function gitSteps(): Step[] {
  return planUpdate({ push: false, build: false }).filter((s: Step) => GIT_TITLES.includes(s.title))
}

describe('runSteps against a fixture repo', () => {
  it('fast-forwards main to upstream and merges it into pilot', async () => {
    const { work } = fixture()
    const result = await runSteps(gitSteps(), { cwd: work })
    expect(result.code).toBe(0)
    expect(git(work, 'rev-parse', 'main')).toBe(git(work, 'rev-parse', 'upstream/main'))
    expect(git(work, 'branch', '--show-current')).toBe('pilot')
    const log = git(work, 'log', '--format=%s', 'pilot')
    expect(log).toContain('pilot.txt')
    expect(log).toContain('upstream-new.txt')
  })

  it('fails the preflight on a dirty tree and runs nothing else', async () => {
    const { work } = fixture()
    writeFileSync(join(work, 'pilot.txt'), 'changed')
    const result = await runSteps(gitSteps(), { cwd: work })
    expect(result.code).not.toBe(0)
    expect(result.failed.title).toBe('Check the working tree is clean')
    expect(git(work, 'log', '--format=%s', 'pilot')).not.toContain('upstream-new.txt')
  })
})
