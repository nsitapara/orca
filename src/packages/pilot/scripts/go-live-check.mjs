#!/usr/bin/env node
// Go-live readiness (build plan Task 47b). Validates every automation file, dry-runs each one against a running
// Pilot, reads the parity tests' JSON report, and prints a markdown section for the vault. A dry run starts
// nothing; it records a dry tick in the Pilot it asks, which must be a scratch copy, never the packaged app's folder.
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { run } from './run.mjs'

const HELP = `Usage: node src/packages/pilot/scripts/go-live-check.mjs --cli <out/cli/index.js> --data <dir> [options]

Prints a markdown summary: each automation validated and dry-run, and the parity tests.

  --cli <path>          the built CLI entry, run with node (pnpm run build:cli makes out/cli/index.js)
  --data <dir>          the data folder of the scratch Pilot to dry-run in (never the packaged app's)
  --dirs <dir>          the automations folder (default ~/.agents/automations)
  --parity-json <file>  vitest's JSON report of src/packages/pilot/test/parity`

const PACKAGED_DATA = join(homedir(), 'Library', 'Application Support', 'Pilot')
const CALL_TIMEOUT_MS = 240_000
const VERDICT_WORDS = [
  ['started', 'started'],
  ['asked', 'asked you'],
  ['skipped', 'skipped'],
  ['notdue', 'not due'],
  ['over_limit', 'next tick'],
  ['baselined', 'baselined'],
  ['out_of_scope', 'not in scope']
]

export function automationFiles(dir) {
  return readdirSync(dir)
    .filter((n) => /\.ya?ml$/.test(n) && !n.startsWith('.') && !/^people\.ya?ml$/.test(n))
    .sort()
    .map((n) => join(dir, n))
}

export function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export function assertScratch(dataDir, packagedDir = PACKAGED_DATA) {
  const clean = (p) => resolve(p).toLowerCase()
  if (clean(dataDir) === clean(packagedDir)) {
    throw new Error(
      `--data must be a scratch copy, not the packaged app's data folder (${packagedDir})`
    )
  }
}

// A dry run's decisions in one line, or why there are none.
export function dryRunLine(outcome) {
  if (!outcome) {
    return 'no answer from Pilot'
  }
  if (outcome.status === 'busy') {
    return 'a tick was already running'
  }
  if (outcome.status === 'unknown') {
    return 'Pilot has no such automation'
  }
  if (outcome.status === 'failed') {
    return `failed: ${outcome.error}`
  }
  const decisions = outcome.decisions ?? []
  if (decisions.length === 0) {
    return 'no items'
  }
  const counts = VERDICT_WORDS.map(([verdict, word]) => [
    decisions.filter((d) => d.verdict === verdict).length,
    word
  ])
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${n} ${word}`)
  return `${decisions.length} items: ${counts.join(' · ')}`
}

function firstLine(text) {
  return text.trim().split('\n')[0]
}

// `call(args)` runs the Pilot CLI and returns { code, stdout, stderr }.
export function checkAutomations({ files, call }) {
  return files.map((file) => {
    const id = basename(file).replace(/\.ya?ml$/, '')
    const validated = call(['automations', 'validate', '--file', file, '--json'])
    const parsed = parseJson(validated.stdout)
    if (!parsed?.ok) {
      const errors = parsed?.errors ?? [
        firstLine(validated.stderr) || `validate exited ${validated.code}`
      ]
      return { id, file, name: id, valid: false, problems: errors, dryRun: 'not run (invalid)' }
    }
    const dry = call(['automations', 'dry-run', '--id', id, '--json'])
    const outcome = dry.code === 0 ? (parseJson(dry.stdout)?.result ?? null) : null
    const line =
      dry.code === 0 ? dryRunLine(outcome) : `failed: ${firstLine(dry.stderr || dry.stdout)}`
    const problems = line.startsWith('failed') || line === 'no answer from Pilot' ? [line] : []
    return { id, file, name: parsed.definition.name, valid: true, problems, dryRun: line }
  })
}

function parityName(path) {
  const marker = 'test/parity/'
  const at = path.indexOf(marker)
  if (at === -1) {
    return basename(path)
  }
  return path.slice(at + marker.length)
}

export function parityRows(report) {
  return (report?.testResults ?? [])
    .map((t) => {
      const results = t.assertionResults ?? []
      return {
        file: parityName(t.name),
        passed: results.filter((a) => a.status === 'passed').length,
        failed: results.filter((a) => a.status === 'failed').length
      }
    })
    .sort((a, b) => a.file.localeCompare(b.file))
}

function parityLine(parity) {
  if (parity.length === 0) {
    return 'Parity tests: none ran.'
  }
  const failed = parity.reduce((n, p) => n + p.failed, 0)
  const files = parity.length === 1 ? '1 file' : `${parity.length} files`
  if (failed === 0) {
    return `Parity tests: ${files}, all passing.`
  }
  return `Parity tests: ${files}, ${failed} failing.`
}

function problemLines(rows, parity) {
  const lines = [
    ...rows.flatMap((r) => r.problems.map((p) => `- ${r.id}: ${p}`)),
    ...parity.filter((p) => p.failed > 0).map((p) => `- parity ${p.file}: ${p.failed} failing`)
  ]
  return lines.length > 0 ? lines : ['- None.']
}

export function renderSummary({ stamp, sha, rows, parity }) {
  const ready = rows.filter((r) => r.valid && r.problems.length === 0).length
  return [
    `## ${stamp} Go-live readiness check · ${ready} of ${rows.length} automations ready`,
    '',
    `Branch \`pilot\` at ${sha}. Each automation was validated, then dry-run against live GitLab, Linear and worktrees in a scratch copy of Pilot's data: nothing started, and nothing was written outside the copy. Every automation stays switched off until you turn it on.`,
    '',
    '| Automation | File | Valid | Dry run |',
    '|---|---|---|---|',
    ...rows.map(
      (r) => `| ${r.name} | \`${basename(r.file)}\` | ${r.valid ? 'yes' : 'no'} | ${r.dryRun} |`
    ),
    '',
    parityLine(parity),
    '',
    '| Parity test | Passed | Failed |',
    '|---|---:|---:|',
    ...parity.map((p) => `| ${p.file} | ${p.passed} | ${p.failed} |`),
    '',
    '**Problems**',
    ...problemLines(rows, parity),
    '',
    '**Before you switch them on (Task 50)**',
    "1. Bring each job's state into Pilot's own data, one automation at a time: preview with `pilot automations import-state --id <id>`, then run it again with `--apply`.",
    '2. Hand the token report over: with job 08 off, run `python3 ~/.agents/skills/worktree-gate/usage.py report` once more, then copy `usage.json` to `usage-legacy.json` in its folder (Pilot\'s README, "Spend and token usage").',
    "3. Leave the Orca-style copies disabled in Orca (`orca automations list` there shows them all off). Pilot's desktop app no longer runs Orca's engine.",
    '4. Switch each automation on with `pilot automations enable --id <id>`, then watch its first tick in its Activity and in the worktree panel.',
    ''
  ].join('\n')
}

function parseArgs(argv) {
  const options = { dirs: join(homedir(), '.agents', 'automations') }
  const names = {
    '--cli': 'cli',
    '--data': 'data',
    '--dirs': 'dirs',
    '--parity-json': 'parityJson'
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--help' || argv[i] === '-h') {
      options.help = true
    } else if (names[argv[i]] && argv[i + 1] !== undefined) {
      options[names[argv[i]]] = argv[i + 1]
      i += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${argv[i]}`)
    }
  }
  return options
}

function stampNow() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function main(argv) {
  const options = parseArgs(argv)
  if (options.help || !options.cli || !options.data) {
    console.log(HELP)
    return options.help ? 0 : 2
  }
  assertScratch(options.data)
  const env = { ...process.env, ORCA_USER_DATA_PATH: options.data }
  const call = (args) => run('node', [options.cli, ...args], { env, timeoutMs: CALL_TIMEOUT_MS })
  const rows = checkAutomations({ files: automationFiles(options.dirs), call })
  const report = options.parityJson ? parseJson(readFileSync(options.parityJson, 'utf8')) : null
  const sha = run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim()
  console.log(renderSummary({ stamp: stampNow(), sha, rows, parity: parityRows(report) }))
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exit(main(process.argv.slice(2)))
}
