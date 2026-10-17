#!/usr/bin/env node
// One command to take upstream Orca updates (D24): main mirrors upstream, pilot merges main, then verify.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseHooksTable } from './hook-guard.mjs'
import { run, runInherit } from './run.mjs'

const REPO = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const CLEAN_TITLE = 'Check the working tree is clean'
const MERGE_TITLE = 'Merge main into pilot'
const VITEST = ['exec', 'vitest', 'run', '--config', 'config/vitest.config.ts']

// R10: the hook reviews ran these folders' tests whole. Any other hooked file runs the tests named
// after it (`<file>.test.ts(x)`; vitest matches the path prefix). Config files (tsconfig, CSS) have
// no tests: the typecheck and the build cover them.
export const R10_FOLDERS = [
  'src/cli/specs',
  'src/main/linear',
  'src/main/orcad',
  'src/main/runtime',
  'src/main/startup',
  'src/main/updater',
  'src/renderer/src/app-shell',
  // activity: its hooked files have no same-name tests, so per-file targets ran none.
  'src/renderer/src/components/activity',
  'src/renderer/src/components/right-sidebar',
  // skill-open-file: SkillDetailDialog has no test of its own; the skills page's tests render it.
  'src/renderer/src/components/skills'
]
const CODE_FILE = /\.tsx?$/

// The vitest filters for every hooked upstream file in HOOKS.md (rows from parseHooksTable). Only code under src/
// has upstream tests next to it (HOOKS.md, After an upstream sync); a hooked config file such as
// config/vitest.config.ts has none.
export function hookTestTargets(rows) {
  const targets = new Set()
  for (const { file } of rows) {
    if (!file.startsWith('src/') || !CODE_FILE.test(file)) {
      continue
    }
    const folder = R10_FOLDERS.find((f) => file.startsWith(`${f}/`))
    targets.add(folder ?? file.replace(CODE_FILE, '.test'))
  }
  return [...targets].sort()
}

// Why: serve-mode tests start upstream's CLI auto-install. Without ORCA_CLI_INSTALL_PATH it searches
// PATH, and from an Orca terminal that finds real Orca's bin/orca and links it to itself. An empty
// An empty ORCA_BROWSER_EXECUTABLE is "unconfigured" upstream: it only blocks the Chromium fallback.
// Orcad still prefers an installed /Applications/Orca.app as its browser host (see README Known gaps).
export function testEnv(dir = tmpdir()) {
  return {
    ORCA_CLI_INSTALL_PATH: join(dir, `pilot-test-cli-${process.pid}`, 'orca'),
    ORCA_BROWSER_EXECUTABLE: ''
  }
}

export function planUpdate({ push, build, hookTests }) {
  // An empty filter list would make vitest run the whole suite instead.
  if (!hookTests?.length) {
    throw new Error('No upstream tests next to the hooks: is HOOKS.md readable?')
  }
  const steps = [
    {
      title: CLEAN_TITLE,
      cmd: 'sh',
      args: ['-c', 'git diff --quiet && git diff --cached --quiet']
    },
    {
      title: 'Fetch upstream and origin',
      cmd: 'git',
      args: ['fetch', '--multiple', 'upstream', 'origin']
    },
    {
      title: 'Fast-forward main to upstream/main',
      cmd: 'sh',
      args: ['-c', 'git switch main && git merge --ff-only upstream/main']
    },
    {
      title: MERGE_TITLE,
      cmd: 'sh',
      args: ['-c', 'git switch pilot && git merge --no-edit main']
    },
    { title: 'Install dependencies', cmd: 'pnpm', args: ['install', '--frozen-lockfile'] },
    {
      title: 'Check Pilot hooks',
      cmd: 'node',
      args: ['src/packages/pilot/scripts/hook-guard.mjs', 'upstream/main']
    },
    { title: 'Build workspace packages', cmd: 'pnpm', args: ['run', 'build:packages'] },
    { title: 'Typecheck', cmd: 'pnpm', args: ['typecheck'] },
    {
      title: 'Run Pilot tests',
      cmd: 'pnpm',
      args: [...VITEST, 'src/packages/pilot'],
      env: testEnv()
    },
    {
      title: "Run upstream tests next to Pilot's hooks",
      cmd: 'pnpm',
      args: [...VITEST, ...hookTests],
      env: testEnv()
    }
  ]
  if (push) {
    steps.push({
      title: 'Push main and pilot to origin',
      cmd: 'git',
      args: ['push', 'origin', 'main', 'pilot']
    })
  }
  if (build) {
    steps.push({
      title: 'Build and install Pilot.app',
      cmd: 'node',
      args: ['src/packages/pilot/scripts/build-mac.mjs']
    })
  }
  return steps
}

function reportFailure(step, cwd, reachedMerge) {
  const branch = run('git', ['branch', '--show-current'], { cwd }).stdout.trim()
  if (step.title === CLEAN_TITLE) {
    console.error('\nCommit or stash your changes first.')
    return
  }
  console.error(`\n✗ ${step.title} failed. You're on branch ${branch}.`)
  if (reachedMerge) {
    console.error(
      '  Conflicts can only be in a hook line listed in HOOKS.md (src/packages/pilot/HOOKS.md). Fix, commit, and run this again.'
    )
  }
}

// Runs steps in order, stopping at the first failure. Returns { code, failed? }.
export async function runSteps(steps, { cwd = REPO, dryRun = false } = {}) {
  const mergeIndex = steps.findIndex((s) => s.title === MERGE_TITLE)
  for (const [i, step] of steps.entries()) {
    console.log(`\n[${i + 1}/${steps.length}] ${step.title}`)
    if (dryRun) {
      console.log(`  ${step.cmd} ${step.args.join(' ')}`)
      if (step.env) {
        console.log(`  env: ${JSON.stringify(step.env)}`)
      }
      continue
    }
    const code = await runInherit(step.cmd, step.args, {
      cwd,
      env: step.env && { ...process.env, ...step.env }
    })
    if (code === 0) {
      continue
    }
    reportFailure(step, cwd, mergeIndex !== -1 && i >= mergeIndex)
    return { code, failed: step }
  }
  return { code: 0 }
}

const HELP = `Usage: node src/packages/pilot/scripts/update.mjs [--dry-run] [--push] [--build]
  Takes upstream Orca: fast-forwards main, merges main into pilot, installs, checks hooks, typechecks,
  runs Pilot's tests and the upstream tests next to each hook in HOOKS.md.
  --push   also push main and pilot to origin (off by default)
  --build  also build Pilot.app at the end and install it into /Applications (build-mac.mjs: quits, replaces and relaunches Pilot)
  --dry-run  print the steps without running them`

export async function runUpdate(argv) {
  if (argv.includes('--help')) {
    console.log(HELP)
    return 0
  }
  const hooks = readFileSync(join(REPO, 'src/packages/pilot/HOOKS.md'), 'utf8')
  const steps = planUpdate({
    push: argv.includes('--push'),
    build: argv.includes('--build'),
    hookTests: hookTestTargets(parseHooksTable(hooks))
  })
  const result = await runSteps(steps, { cwd: REPO, dryRun: argv.includes('--dry-run') })
  if (result.code === 0) {
    console.log('\n✓ Pilot is up to date with upstream Orca.')
  }
  return result.code
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exit(await runUpdate(process.argv.slice(2)))
}
