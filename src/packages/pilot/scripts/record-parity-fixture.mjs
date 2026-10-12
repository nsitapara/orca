#!/usr/bin/env node
// Records a parity case for one job: runs the old sweep's plan (test/parity/run_old_plan.py --record) with live,
// read-only access. Only known read commands run (GitLab GETs, orca and git reads); anything else stops the
// recording before it runs. The case is written as test/parity/<job>/live-<case>.json, which git ignores.

import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './run.mjs'

export const PARITY_DIR = fileURLToPath(new URL('../test/parity/', import.meta.url))
const RECORD_TIMEOUT_MS = 600_000

const HELP = `Usage: node src/packages/pilot/scripts/record-parity-fixture.mjs --job <code> --case <name> [--force]

Records what the old sweep for <code> reads right now (GET-only) into test/parity/<code>/live-<name>.json.
Git ignores live-*.json: they hold real MR titles, branches and usernames.

  --job <code>     a job adapter in test/parity/jobs (05, ...)
  --case <name>    a short name: a-z, 0-9 and -
  --force          replace a case of that name
Env: PARITY_SKILLS_DIR (default ~/.agents/skills)`

export function parseArgs(argv) {
  const options = { job: undefined, kase: undefined, force: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--force') {
      options.force = true
    } else if (arg === '--help' || arg === '-h') {
      options.help = true
    } else if ((arg === '--job' || arg === '--case') && argv[i + 1] !== undefined) {
      options[arg === '--job' ? 'job' : 'kase'] = argv[i + 1]
      i += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`)
    }
  }
  if (options.help) {
    return options
  }
  if (!options.job) {
    throw new Error('--job <code> is required')
  }
  if (!/^[A-Za-z0-9]+$/.test(options.job)) {
    throw new Error('--job may use letters and digits only')
  }
  if (!options.kase) {
    throw new Error('--case <name> is required')
  }
  if (!/^[a-z0-9-]+$/.test(options.kase)) {
    throw new Error('--case may use a-z, 0-9 and - only')
  }
  return options
}

export function fixturePath(job, kase, root = PARITY_DIR) {
  return join(root, job, `live-${kase}.json`)
}

export function recordFixture({ job, kase, force }, deps = {}) {
  const runner = deps.runner ?? run
  const log = deps.log ?? console.log
  const out = fixturePath(job, kase, deps.root ?? PARITY_DIR)
  if (existsSync(out) && !force) {
    throw new Error(`${out} exists; pass --force to replace it`)
  }
  mkdirSync(dirname(out), { recursive: true })
  const result = runner(
    'python3',
    [join(PARITY_DIR, 'run_old_plan.py'), job, '--record', out, '--case', kase],
    {
      timeoutMs: RECORD_TIMEOUT_MS,
      // The old sweep's `git status` runs on live worktrees: without optional locks it never takes an
      // agent's index.lock. The python recorder and gate.git inherit this environment.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
    }
  )
  if (result.code !== 0) {
    throw new Error(
      `The recording stopped (exit ${result.code}): ${(result.stderr || result.stdout || '').trim()}`
    )
  }
  log(`Recorded ${out}`)
  return out
}

export function runCli(argv, deps = {}) {
  const log = deps.log ?? console.log
  const logError = deps.logError ?? console.error
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    logError(error.message)
    logError(HELP)
    return 2
  }
  if (options.help) {
    log(HELP)
    return 0
  }
  try {
    recordFixture(options, deps)
    return 0
  } catch (error) {
    logError(error.message)
    return 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exit(runCli(process.argv.slice(2)))
}
