import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './run.mjs'
// @ts-expect-error -- .mjs script without type declarations
import { parseHooksTable } from './hook-guard.mjs'
// @ts-expect-error -- .mjs script without type declarations
import { hookTestTargets, planUpdate, runSteps } from './update.mjs'

type Step = { title: string; cmd: string; args: string[] }

const HOOK_TESTS = ['src/main/startup']
const plan = (opts: { push: boolean; build: boolean }): Step[] =>
  planUpdate({ ...opts, hookTests: HOOK_TESTS })

describe('planUpdate', () => {
  it('syncs main from upstream, merges it into pilot, then verifies', () => {
    expect(plan({ push: false, build: false }).map((s: Step) => s.title)).toEqual([
      'Check the working tree is clean',
      'Fetch upstream and origin',
      'Fast-forward main to upstream/main',
      'Merge main into pilot',
      'Install dependencies',
      'Check Pilot hooks',
      'Build workspace packages',
      'Typecheck',
      'Run Pilot tests',
      "Run upstream tests next to Pilot's hooks"
    ])
  })

  it('runs the upstream tests it is given, and refuses an empty list (vitest would run everything)', () => {
    const step = plan({ push: false, build: false }).at(-1)
    expect(step?.args).toEqual([
      'exec',
      'vitest',
      'run',
      '--config',
      'config/vitest.config.ts',
      'src/main/startup'
    ])
    expect(() => planUpdate({ push: false, build: false, hookTests: [] })).toThrow('HOOKS.md')
  })

  it('runs both test steps with a throwaway CLI install path and no browser app', () => {
    const steps = plan({ push: false, build: false }).filter((s: Step & { env?: object }) =>
      s.title.startsWith('Run ')
    ) as (Step & { env?: Record<string, string> })[]
    expect(steps).toHaveLength(2)
    for (const step of steps) {
      expect(step.env?.ORCA_CLI_INSTALL_PATH.startsWith(tmpdir())).toBe(true)
      expect(step.env?.ORCA_BROWSER_EXECUTABLE).toBe('')
    }
  })

  it('pushes only when asked', () => {
    const titles = plan({ push: true, build: false }).map((s: Step) => s.title)
    expect(titles).toContain('Push main and pilot to origin')
    const off = plan({ push: false, build: false }).map((s: Step) => s.title)
    expect(off).not.toContain('Push main and pilot to origin')
  })

  it('builds the app last when asked', () => {
    const steps = plan({ push: false, build: true })
    expect(steps.at(-1)?.title).toBe('Build and install Pilot.app')
  })
})

describe('hookTestTargets', () => {
  // R10: the folders the hook reviews ran whole, else the tests named after the hooked file.
  it('maps each hooked code file in HOOKS.md to the upstream tests next to it', () => {
    const rows = parseHooksTable(readFileSync(join(import.meta.dirname, '../HOOKS.md'), 'utf8'))
    expect(hookTestTargets(rows)).toEqual([
      'src/cli/dispatch.test',
      'src/cli/specs',
      'src/main/linear',
      'src/main/orcad',
      'src/main/runtime',
      'src/main/startup',
      'src/main/updater',
      'src/renderer/src/app-shell',
      'src/renderer/src/components/TerminalTitlebarTabs.test',
      'src/renderer/src/components/TerminalWorkspaceDialogs.test',
      'src/renderer/src/components/activity/activity-thread-options-menu.test',
      'src/renderer/src/components/right-sidebar',
      'src/renderer/src/components/sidebar/SidebarAgentsList.test',
      'src/renderer/src/components/sidebar/SidebarNav.test',
      'src/renderer/src/components/skills',
      'src/renderer/src/components/tab-bar/use-tab-bar-runtime-model.test',
      'src/renderer/src/components/tab-group/TabGroupPanel.test',
      'src/renderer/src/components/terminal-workspace-keydown.test',
      'src/renderer/src/hooks/ipc-events/tab-lifecycle-ipc-bridge.test',
      'src/renderer/src/main.test',
      'src/renderer/src/store/right-sidebar-route.test'
    ])
  })

  it('skips config files, and code outside src/, and lists each target once', () => {
    expect(
      hookTestTargets([
        { file: 'config/tsconfig.node.json' },
        { file: 'config/vitest.config.ts' },
        { file: 'src/renderer/src/assets/main.css' },
        { file: 'src/main/startup/a.ts' },
        { file: 'src/main/startup/b.ts' },
        { file: 'src/x/y.tsx' }
      ])
    ).toEqual(['src/main/startup', 'src/x/y.test'])
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
  return plan({ push: false, build: false }).filter((s: Step) => GIT_TITLES.includes(s.title))
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
