#!/usr/bin/env node
// One command to take upstream Orca updates (D24): main mirrors upstream, pilot merges main, then verify.
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, runInherit } from './run.mjs'

const REPO = resolve(fileURLToPath(new URL('../../../..', import.meta.url)))
const CLEAN_TITLE = 'Check the working tree is clean'
const MERGE_TITLE = 'Merge main into pilot'

export function planUpdate({ push, build }) {
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
      args: ['exec', 'vitest', 'run', '--config', 'config/vitest.config.ts', 'src/packages/pilot']
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
      title: 'Build Pilot.app',
      cmd: 'node',
      args: ['src/packages/pilot/scripts/build-mac.mjs']
    })
  }
  return steps
}

function reportFailure(step, code, cwd, reachedMerge) {
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
      continue
    }
    const code = await runInherit(step.cmd, step.args, { cwd })
    if (code === 0) {
      continue
    }
    reportFailure(step, code, cwd, mergeIndex !== -1 && i >= mergeIndex)
    return { code, failed: step }
  }
  return { code: 0 }
}

const HELP = `Usage: node src/packages/pilot/scripts/update.mjs [--dry-run] [--push] [--build]
  Takes upstream Orca: fast-forwards main, merges main into pilot, installs, checks hooks, typechecks, tests.
  --push   also push main and pilot to origin (off by default)
  --build  also build Pilot.app at the end
  --dry-run  print the steps without running them`

export async function runUpdate(argv) {
  if (argv.includes('--help')) {
    console.log(HELP)
    return 0
  }
  const steps = planUpdate({ push: argv.includes('--push'), build: argv.includes('--build') })
  const result = await runSteps(steps, { cwd: REPO, dryRun: argv.includes('--dry-run') })
  if (result.code === 0) {
    console.log('\n✓ Pilot is up to date with upstream Orca.')
  }
  return result.code
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exit(await runUpdate(process.argv.slice(2)))
}
