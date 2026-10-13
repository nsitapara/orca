import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadPortedAutomation } from './ported'

// Orca's saved precheck for 01 (scratchpad move/dry-01.txt), verbatim.
const MAIN = '/Users/nishsitapara/Documents/web-platform'
const OLD_PRECHECK = `cd ${MAIN} && if [ "$(git branch --show-current)" = dev ]; then git pull --ff-only origin dev; else git fetch origin dev:dev; fi; exit 1`

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Parity',
  GIT_AUTHOR_EMAIL: 'parity@example.com',
  GIT_COMMITTER_NAME: 'Parity',
  GIT_COMMITTER_EMAIL: 'parity@example.com',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1'
}

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  }
  return r.stdout.trim()
}

// Like the shell step: /bin/sh -c in the checkout, stdout and stderr together.
function sh(command: string, cwd: string): { code: number | null; out: string } {
  const r = spawnSync('/bin/sh', ['-c', command], { cwd, env: GIT_ENV, encoding: 'utf8' })
  return { code: r.status, out: `${r.stdout}${r.stderr}` }
}

// The command with the real checkout swapped for a temp one. Refuses one that would cd anywhere else, so a
// changed path in the YAML can never run git against Nish's checkout.
function inCheckout(command: string, repo: string): string {
  const swapped = command.replaceAll(MAIN, repo)
  if (!swapped.startsWith(`cd ${repo} && `)) {
    throw new Error(`refusing to run a command that doesn't cd into the temp checkout: ${command}`)
  }
  return swapped
}

type Setup = 'on-dev-behind' | 'on-feature-behind' | 'on-dev-dirty'

// A checkout of origin whose dev is one commit behind origin's.
function checkout(setup: Setup): { repo: string; originDev: string } {
  const root = mkdtempSync(join(tmpdir(), 'pilot-01-'))
  git(root, 'init', '-q', '--bare', 'origin.git')
  git(root, 'clone', '-q', 'origin.git', 'seed')
  const seed = join(root, 'seed')
  writeFileSync(join(seed, 'a.txt'), 'one\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-qm', 'one')
  git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/dev')
  git(root, 'clone', '-q', '-b', 'dev', 'origin.git', 'repo')
  writeFileSync(join(seed, 'a.txt'), 'two\n')
  git(seed, 'commit', '-qam', 'two')
  git(seed, 'push', '-q', 'origin', 'HEAD:refs/heads/dev')
  const repo = join(root, 'repo')
  if (setup === 'on-feature-behind') {
    git(repo, 'checkout', '-qb', 'feature')
  }
  if (setup === 'on-dev-dirty') {
    writeFileSync(join(repo, 'a.txt'), 'mine\n')
  }
  return { repo, originDev: git(seed, 'rev-parse', 'HEAD') }
}

const PULLED = /^(Updating|Fast-forward)/m
const { definition } = loadPortedAutomation('pull-dev')

describe('01 · Pull latest dev into local dev, as a run-once shell step', () => {
  it("keeps Orca's schedule, zone and grace, and runs the precheck's command without its exit 1", () => {
    expect(definition).toMatchObject({
      name: '01 · Pull latest dev into local dev',
      repo: 'web-platform',
      schedule: '0 * * * *',
      timezone: 'America/Los_Angeles',
      enabled: true, // live since go-live stage A (2026-10-13)
      missedRunGraceMs: 12 * 3_600_000,
      items: null,
      checks: [],
      workspace: { kind: 'main_checkout' },
      powers: []
    })
    expect(definition.steps).toHaveLength(1)
    expect(definition.steps[0]).toMatchObject({
      name: 'pull',
      agent: 'shell',
      run: OLD_PRECHECK.replace(/; exit 1$/, ''),
      timeoutMs: 120_000,
      exitCodes: { ok: [0], skip: [] }
    })
  })

  it.each<[Setup, boolean]>([
    ['on-dev-behind', true],
    ['on-feature-behind', true],
    ['on-dev-dirty', false]
  ])('%s: moves dev exactly as the old precheck did (step ok: %s)', (setup, ok) => {
    const old = checkout(setup)
    const neu = checkout(setup)
    const oldRun = sh(inCheckout(OLD_PRECHECK, old.repo), old.repo)
    const newRun = sh(inCheckout(definition.steps[0].run!, neu.repo), neu.repo)
    expect(oldRun.code).toBe(1)
    expect(newRun.code === 0).toBe(ok)
    expect(git(neu.repo, 'rev-parse', 'dev') === neu.originDev).toBe(
      git(old.repo, 'rev-parse', 'dev') === old.originDev
    )
    expect(git(neu.repo, 'branch', '--show-current')).toBe(
      git(old.repo, 'branch', '--show-current')
    )
    expect(PULLED.test(newRun.out)).toBe(PULLED.test(oldRun.out))
  })
})
