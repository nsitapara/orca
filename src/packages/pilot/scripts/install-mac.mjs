// Installs the built Pilot.app into /Applications, refreshes the `pilot` link, and relaunches it.
// Every shell call goes through deps.run so tests stub them; nothing here runs at import time.
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { run } from './run.mjs'

export const BUNDLE_ID = 'dev.nsitapara.pilot'
export const INSTALL_PATH = '/Applications/Pilot.app'
export const LSREGISTER =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister'
// A running Pilot's main process, installed or still in dist/. Helper processes live under Frameworks/.
export const MAIN_PROCESS_PATTERN =
  '(^|/)(Applications|dist/mac[^/ ]*)/Pilot\\.app/Contents/MacOS/Pilot( |$)'
export const EXIT_TIMEOUT_MS = 30_000
export const CLI_TIMEOUT_MS = 60_000
const POLL_MS = 500

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function defaultDeps() {
  return { run, sleep, now: () => Date.now(), log: (m) => console.log(m), home: homedir() }
}

export function linkPath(home) {
  return join(home, '.local', 'bin', 'pilot')
}

export function logPath(home) {
  return join(home, 'Library', 'Application Support', 'Pilot', 'logs')
}

export function installedCli() {
  return `${INSTALL_PATH}/Contents/Resources/bin/pilot`
}

// Why: the app must not inherit ORCA_* from an Orca terminal, so it starts from a cleared environment.
export function cleanEnvArgs(home, parentEnv = process.env) {
  const keep = ['USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'SSH_AUTH_SOCK']
  const pairs = [`HOME=${home}`]
  for (const key of keep) {
    if (parentEnv[key]) {
      pairs.push(`${key}=${parentEnv[key]}`)
    }
  }
  pairs.push('PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin')
  return ['-i', ...pairs]
}

export function isRunning(deps) {
  return deps.run('pgrep', ['-f', MAIN_PROCESS_PATTERN]).code === 0
}

// Asks Pilot to quit and waits for its main process to exit. Never force-kills.
export async function quitPilot(deps, timeoutMs = EXIT_TIMEOUT_MS) {
  if (!isRunning(deps)) {
    return
  }
  deps.log('Quitting the running Pilot…')
  deps.run('osascript', ['-e', `tell application id "${BUNDLE_ID}" to quit`])
  const deadline = deps.now() + timeoutMs
  while (isRunning(deps)) {
    if (deps.now() >= deadline) {
      throw new Error(
        `Pilot is still running after ${timeoutMs / 1000}s. Quit it yourself (it may be asking to save or confirm), then build again.`
      )
    }
    await deps.sleep(POLL_MS)
  }
}

export function copyApp(deps, source) {
  const r = deps.run('ditto', [source, INSTALL_PATH])
  if (r.code !== 0) {
    throw new Error(
      `ditto ${source} ${INSTALL_PATH} failed: ${(r.stderr || r.stdout || '').trim()}`
    )
  }
}

export function linkCli(deps) {
  const link = linkPath(deps.home)
  deps.run('mkdir', ['-p', join(deps.home, '.local', 'bin')])
  const r = deps.run('ln', ['-sfn', installedCli(), link])
  if (r.code !== 0) {
    throw new Error(`Could not link ${link}: ${(r.stderr || '').trim()}`)
  }
}

export function registerApp(deps) {
  deps.run(LSREGISTER, ['-f', INSTALL_PATH])
}

export function launchApp(deps, parentEnv = process.env) {
  const r = deps.run('env', [...cleanEnvArgs(deps.home, parentEnv), '/usr/bin/open', INSTALL_PATH])
  if (r.code !== 0) {
    throw new Error(`open ${INSTALL_PATH} failed: ${(r.stderr || '').trim()}`)
  }
}

function cliCall(deps, args, parentEnv) {
  return deps.run('env', [...cleanEnvArgs(deps.home, parentEnv), installedCli(), ...args])
}

function parseAutomations(stdout) {
  let data
  try {
    data = JSON.parse(stdout)
  } catch {
    return null
  }
  if (!data || data.ok === false) {
    return null
  }
  const result = data.result ?? data
  return Array.isArray(result) ? result : (result.automations ?? null)
}

// Polls `pilot automations list-yaml --json` until it answers ok. Returns the automations list.
export async function waitForCli(deps, timeoutMs = CLI_TIMEOUT_MS, parentEnv = process.env) {
  const deadline = deps.now() + timeoutMs
  for (;;) {
    const r = cliCall(deps, ['automations', 'list-yaml', '--json'], parentEnv)
    const list = r.code === 0 ? parseAutomations(r.stdout) : null
    if (list) {
      return list
    }
    if (deps.now() >= deadline) {
      throw new Error(
        `Pilot didn't start; see logs at ${logPath(deps.home)} (no answer from the CLI in ${timeoutMs / 1000}s).`
      )
    }
    await deps.sleep(POLL_MS)
  }
}

export function enabledNames(automations) {
  return automations.filter((a) => a.enabled).map((a) => a.name ?? a.id)
}

export function buildCommit(deps, cwd) {
  const r = deps.run('git', ['rev-parse', '--short', 'HEAD'], { cwd })
  return r.code === 0 ? r.stdout.trim() : 'unknown'
}

// Why: with this marker Spotlight and Raycast list only /Applications/Pilot.app, not the build output.
export function markNoIndex(distDir, write = writeFileSync, mkdir = mkdirSync) {
  mkdir(distDir, { recursive: true })
  write(join(distDir, '.metadata_never_index'), '')
}

export function summary({ commit, automations }) {
  const names = enabledNames(automations)
  const lines = [
    `Build commit: ${commit}`,
    `Installed at: ${INSTALL_PATH}`,
    `Enabled automations (${names.length}): ${names.length ? names.join(', ') : 'none'}`
  ]
  return lines.join('\n')
}

// The whole install. Returns the summary text, or null with --no-launch (nothing to ask the CLI).
export async function installPilot({
  source,
  repo,
  launch = true,
  deps = defaultDeps(),
  parentEnv = process.env
}) {
  await quitPilot(deps)
  copyApp(deps, source)
  linkCli(deps)
  registerApp(deps)
  if (!launch) {
    return `Installed at: ${INSTALL_PATH} (not launched)`
  }
  launchApp(deps, parentEnv)
  const automations = await waitForCli(deps, CLI_TIMEOUT_MS, parentEnv)
  return summary({ commit: buildCommit(deps, repo), automations })
}
