#!/usr/bin/env node
// Go-live readiness (build plan Task 47b). Validates every automation file, dry-runs each one against a running
// Pilot, reads the parity tests' JSON report, and prints a markdown section for the vault. A dry run starts
// nothing; it records a dry tick in the Pilot it asks, which must be a scratch copy, never the packaged app's folder.
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { folderSpellings } from './orca-import-policy.mjs'
import { readPilotState } from './orca-profile-reader.mjs'
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

// Upstream's default args when Settings has none for the agent (YOLO_TUI_AGENT_ARGS, src/shared/tui-agent-permissions.ts).
const DEFAULT_AGENT_ARGS = {
  claude: '--dangerously-skip-permissions',
  codex: '--dangerously-bypass-approvals-and-sandbox'
}
// Options a CLI takes many times (Codex's `-c key=value` overrides), so a repeat is fine.
const REPEATABLE_OPTIONS = new Set(['-c', '--config'])

// The command Pilot launches each agent with before a step's args: Settings' command and its default args.
export function agentCommands(settings) {
  const overrides = settings?.agentCmdOverrides ?? {}
  const configured = settings?.agentDefaultArgs ?? {}
  return Object.fromEntries(
    Object.entries(DEFAULT_AGENT_ARGS).map(([agent, fallback]) => {
      const args = Object.hasOwn(configured, agent) ? configured[agent] : fallback
      return [agent, `${overrides[agent] || agent} ${args}`.trim()]
    })
  )
}

// The option names in a command or an argv, quotes and `=value` dropped.
function optionNames(tokens) {
  return tokens
    .map((token) => token.replace(/^['"]|['"]$/g, ''))
    .filter((token) => token.startsWith('-'))
    .map((token) => token.split('=')[0])
}

// Steps whose args repeat an option their agent's command already has: Codex refuses a repeated flag.
export function repeatedAgentFlags(definition, commands) {
  const problems = []
  for (const step of definition.steps ?? []) {
    const command = commands[step.agent]
    if (!command) {
      continue
    }
    const configured = new Set(optionNames(command.split(/\s+/)))
    const repeated = new Set(
      optionNames(step.args ?? []).filter((n) => configured.has(n) && !REPEATABLE_OPTIONS.has(n))
    )
    for (const flag of repeated) {
      problems.push(
        `step ${step.name} repeats ${flag}, which Pilot's ${step.agent} command already has (${command}): the agent may refuse to start`
      )
    }
  }
  return problems
}

// What an unattended step needs on its command line. Codex: approvals and its sandbox off, or it stops at its first
// prompt and can't commit (gate.AGENTS, codex-cli 0.160.1). Claude takes its permissions from ~/.claude/settings.json,
// as the old jobs' plain `claude` launch did, so it needs nothing here.
const UNATTENDED_FLAGS = { codex: ['--dangerously-bypass-approvals-and-sandbox', '--yolo'] }

// Steps whose command and args together lack their agent's unattended flag.
export function missingUnattendedFlags(definition, commands) {
  const problems = []
  for (const step of definition.steps ?? []) {
    const command = commands[step.agent]
    const required = UNATTENDED_FLAGS[step.agent]
    if (!command || !required) {
      continue
    }
    const args = step.args ?? []
    const present = new Set(optionNames([...command.split(/\s+/), ...args]))
    if (!required.some((flag) => present.has(flag))) {
      problems.push(
        `step ${step.name} runs Codex without ${required[0]} (${[command, ...args].join(' ')}): unattended, it stops at Codex's first approval prompt`
      )
    }
  }
  return problems
}

// The scratch profile's Settings, or null when it has none yet.
export function settingsFromData(dataDir) {
  const payload = readPilotState(join(dataDir, 'profiles', 'local-default')).domains.get('settings')
  return payload === undefined ? null : JSON.parse(payload)
}

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

// Every spelling of each folder (as given and through symlinks), so a link to the packaged folder is refused too.
export function assertScratch(dataDir, packagedDir = PACKAGED_DATA) {
  const packaged = new Set(folderSpellings(packagedDir).map((p) => p.toLowerCase()))
  if (folderSpellings(dataDir).some((p) => packaged.has(p.toLowerCase()))) {
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
export function checkAutomations({ files, call, commands = {} }) {
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
    problems.push(...repeatedAgentFlags(parsed.definition, commands))
    problems.push(...missingUnattendedFlags(parsed.definition, commands))
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

const VAULT_BUNDLE_NOTE = 'Details bundle: '

// How many waiting cards (`inbox list` returns open and answered ones) carry a Details bundle, and how many
// imported ones still only point at a vault bundle. Read from `inbox list --json`, which is GET-only:
// nothing is added or changed.
export function detailsLine(listPayload, failure = '') {
  if (!listPayload || !Array.isArray(listPayload.items)) {
    return `Card details: couldn't list the inbox (${firstLine(failure).slice(0, 200) || 'no answer from Pilot'})`
  }
  const items = listPayload.items
  const withBundle = items.filter((item) => item.details).length
  const legacy = items.filter(
    (item) =>
      item.source === 'import' &&
      !item.details &&
      typeof item.detailsMd === 'string' &&
      item.detailsMd.startsWith(VAULT_BUNDLE_NOTE)
  ).length
  return `Card details: ${items.length} waiting cards, ${withBundle} with a Details bundle, ${legacy} imported cards still pointing at a vault bundle.`
}

function problemLines(rows, parity) {
  const lines = [
    ...rows.flatMap((r) => r.problems.map((p) => `- ${r.id}: ${p}`)),
    ...parity.filter((p) => p.failed > 0).map((p) => `- parity ${p.file}: ${p.failed} failing`)
  ]
  return lines.length > 0 ? lines : ['- None.']
}

export function renderSummary({ stamp, sha, rows, parity, cardDetails }) {
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
    ...(cardDetails ? [cardDetails, ''] : []),
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
  const commands = agentCommands(settingsFromData(options.data))
  const rows = checkAutomations({ files: automationFiles(options.dirs), call, commands })
  const report = options.parityJson ? parseJson(readFileSync(options.parityJson, 'utf8')) : null
  const listed = call(['inbox', 'list', '--json'])
  const cardDetails = detailsLine(
    listed.code === 0 ? parseJson(listed.stdout)?.result : null,
    listed.stderr || listed.stdout
  )
  const sha = run('git', ['rev-parse', '--short', 'HEAD']).stdout.trim()
  console.log(
    renderSummary({ stamp: stampNow(), sha, rows, parity: parityRows(report), cardDetails })
  )
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  process.exit(main(process.argv.slice(2)))
}
