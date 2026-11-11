import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Exec } from './foreign-exec'
import { shQuote, type ForeignLaunch, type ForeignLauncher } from './foreign-launch'

// pilotd's own herdr session: hand-over sessions from either engine sit together, never in Nish's default one.
export const HERDR_SESSION = 'pilotd'
// How long a new pane's shell may take to draw its prompt before the launcher is typed anyway (pilotd's PROMPT_WAIT).
const PROMPT_WAIT_MS = 15_000
const PROMPT_POLL_MS = 200
const SERVER_WAIT_MS = 10_000
// How long after the launch Pilot watches the pane for Claude's folder-trust dialog, which would hold the session.
const TRUST_WATCH_MS = 20_000
const TRUST_POLL_MS = 1_000
// Claude Code's trust dialog (2.1.x: "Quick safety check: Is this a project you created or one you trust?").
const TRUST_DIALOG = [
  'yes, i trust this folder',
  'quick safety check',
  'do you trust the files in this folder'
]
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

export type HerdrDeps = {
  // The herdr CLI, already pointed at the session (HERDR_SESSION) with a clean env (foreign-exec cliExec).
  herdr: Exec
  // Starts `herdr server` for the session, detached.
  startServer(): void
  // Where the launcher scripts and prompt files go.
  launcherDir: string
  now(): number
  pause(ms: number): Promise<void>
}

type HerdrResult = Record<string, unknown>

function failure(args: readonly string[], stdout: string, stderr: string): Error {
  return new Error(
    `herdr ${args.join(' ')} failed: ${stderr.trim() || stdout.trim() || 'no output'}`
  )
}

// `herdr <args>`'s JSON `.result`; a silent success (pane run) is {}.
async function call(deps: HerdrDeps, args: readonly string[]): Promise<HerdrResult> {
  const { code, stdout, stderr } = await deps.herdr(args)
  if (code !== 0) {
    throw failure(args, stdout, stderr)
  }
  const text = stdout.trim()
  if (!text) {
    return {}
  }
  const parsed = JSON.parse(text) as { result?: HerdrResult }
  return parsed.result ?? (parsed as HerdrResult)
}

function idOf(value: unknown, key: string, what: string): string {
  const id = (value as Record<string, unknown> | undefined)?.[key]
  if (typeof id !== 'string' || !id) {
    throw new Error(`herdr returned no ${what}`)
  }
  return id
}

async function serverRunning(deps: HerdrDeps): Promise<boolean> {
  const { stdout } = await deps.herdr(['status', 'server'])
  return stdout.includes('status: running')
}

async function ensureServer(deps: HerdrDeps): Promise<void> {
  if (await serverRunning(deps)) {
    return
  }
  deps.startServer()
  const deadline = deps.now() + SERVER_WAIT_MS
  while (deps.now() < deadline) {
    await deps.pause(PROMPT_POLL_MS)
    if (await serverRunning(deps)) {
      return
    }
  }
  throw new Error(`herdr's server didn't start within ${SERVER_WAIT_MS / 1000} s`)
}

// The workspace labelled with the repo's name, made at the worktree when there is none.
async function workspaceFor(deps: HerdrDeps, label: string, cwd: string): Promise<string> {
  const list = await call(deps, ['workspace', 'list'])
  const found = ((list.workspaces as HerdrResult[] | undefined) ?? []).find(
    (w) => w.label === label
  )
  if (found) {
    return idOf(found, 'workspace_id', 'workspace id')
  }
  const made = await call(deps, [
    'workspace',
    'create',
    '--cwd',
    cwd,
    '--label',
    label,
    '--no-focus'
  ])
  return idOf(made.workspace, 'workspace_id', 'workspace id')
}

async function waitForPrompt(deps: HerdrDeps, pane: string): Promise<void> {
  const deadline = deps.now() + PROMPT_WAIT_MS
  while (deps.now() < deadline) {
    const read = await deps.herdr([
      'pane',
      'read',
      pane,
      '--source',
      'recent-unwrapped',
      '--lines',
      '5'
    ])
    if (read.code === 0 && read.stdout.trim() !== '') {
      return
    }
    await deps.pause(PROMPT_POLL_MS)
  }
}

// Whether Claude's folder-trust dialog shows in the pane within TRUST_WATCH_MS of the launch. Unanswered, it holds the
// session before the prompt is read, so a launch that hits it isn't a started session.
async function asksForTrust(deps: HerdrDeps, pane: string): Promise<boolean> {
  const deadline = deps.now() + TRUST_WATCH_MS
  while (deps.now() < deadline) {
    await deps.pause(TRUST_POLL_MS)
    const read = await deps.herdr(['pane', 'read', pane, '--source', 'visible'])
    const screen = read.stdout.replace(/\s+/g, ' ').toLowerCase()
    if (read.code === 0 && TRUST_DIALOG.some((marker) => screen.includes(marker))) {
      return true
    }
  }
  return false
}

// The script the tab runs: the step env exported, then the agent with Pilot's argv and the prompt, which is read from
// its own file so no item text is ever typed into the pane.
export function launcherScript(launch: ForeignLaunch, promptFile: string): string {
  const bad = Object.keys(launch.env).find((name) => !ENV_NAME.test(name))
  if (bad !== undefined) {
    throw new Error(`${JSON.stringify(bad)} can't be exported to a herdr launcher`)
  }
  const lines = [
    '#!/bin/sh',
    '# Pilot hand-over step launcher',
    `for v in $(env | grep -oE '^(CLAUDECODE|CLAUDE_CODE_[A-Z0-9_]*|T3CODE_[A-Z0-9_]*|ORCA_TERMINAL_HANDLE|ORCA_PANE_KEY)=' | tr -d =); do unset "$v"; done`,
    ...Object.entries(launch.env).map(([name, value]) => `export ${name}=${shQuote(value)}`),
    `cd ${shQuote(launch.cwd)} || exit 1`,
    `exec ${[launch.agent, ...launch.argv].map(shQuote).join(' ')} "$(cat ${shQuote(promptFile)})"`
  ]
  return `${lines.join('\n')}\n`
}

function writeLauncher(deps: HerdrDeps, launch: ForeignLaunch): string {
  mkdirSync(deps.launcherDir, { recursive: true })
  const base = join(deps.launcherDir, `${launch.runId}-${launch.stepIdx}`)
  writeFileSync(`${base}.prompt`, launch.prompt, { mode: 0o600 })
  writeFileSync(`${base}.sh`, launcherScript(launch, `${base}.prompt`), { mode: 0o700 })
  return `${base}.sh`
}

// A tab in herdr's session, in the repo's workspace, that runs the step's agent once its shell is up. A launcher that
// can't be typed, or a Claude stopped at its trust dialog, closes the tab: no half-made session is left behind.
export function herdrLauncher(deps: HerdrDeps): ForeignLauncher {
  return async (launch) => {
    const launcher = writeLauncher(deps, launch)
    await ensureServer(deps)
    const workspace = await workspaceFor(deps, launch.repo, launch.cwd)
    const made = await call(deps, [
      'tab',
      'create',
      '--workspace',
      workspace,
      '--cwd',
      launch.cwd,
      '--label',
      launch.title,
      '--no-focus'
    ])
    const tab = idOf(made.tab, 'tab_id', 'tab id')
    const pane = idOf(made.root_pane, 'pane_id', 'pane id')
    try {
      await waitForPrompt(deps, pane)
      await call(deps, ['pane', 'run', pane, `sh ${shQuote(launcher)}`])
      if (launch.agent === 'claude' && (await asksForTrust(deps, pane))) {
        throw new Error(
          `Claude asks whether to trust ${launch.cwd}; open Claude there once and trust it`
        )
      }
    } catch (error) {
      await deps.herdr(['tab', 'close', tab]).catch(() => undefined)
      throw error
    }
    return { externalRef: tab, detail: { workspace, tab, pane } }
  }
}
