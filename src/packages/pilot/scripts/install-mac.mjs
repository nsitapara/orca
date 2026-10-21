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
// Anchored to argv[0]: the detached terminal daemon carries the main binary path as a later argument.
export const MAIN_PROCESS_PATTERN =
  '^[^ ]*/(Applications|dist/mac[^/ ]*)/Pilot\\.app/Contents/MacOS/Pilot( |$)'
// The terminal daemon's entry script, in its command line.
export const DAEMON_ENTRY = '/out/main/daemon-entry.js'
export const EXIT_TIMEOUT_MS = 30_000
export const CLI_TIMEOUT_MS = 60_000
const POLL_MS = 500
export const RELAUNCH_PAUSE_MS = 8000 // lets macOS release the old menu-bar item (orca #17045)

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

function pids(result) {
  return result.code === 0 ? result.stdout.split(/\s+/).filter(Boolean) : []
}

export function mainPids(deps) {
  return pids(deps.run('pgrep', ['-f', MAIN_PROCESS_PATTERN]))
}

// Why: helpers whose parent is the old main pid die with it. The terminal daemon survives quits on
// purpose, so it is left out by its entry script: while the main that spawned it runs, the daemon is
// still its child. Read the list before the quit: afterwards the orphans have parent 1 too.
export function helperPids(deps, mainPid) {
  const r = deps.run('pgrep', ['-lf', '-P', mainPid])
  if (r.code !== 0) {
    return []
  }
  return r.stdout
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.includes(DAEMON_ENTRY))
    .map((line) => line.trim().split(/\s+/)[0])
}

export function dbFiles(home) {
  const base = join(logPath(home), '..', 'pilot-automations.db')
  return [base, `${base}-wal`, `${base}-shm`]
}

function alive(deps, pid) {
  return deps.run('ps', ['-p', pid]).code === 0
}

function holdsDb(deps) {
  return deps.run('lsof', ['-t', ...dbFiles(deps.home)]).stdout.trim() !== ''
}

async function waitUntil(deps, done, timeoutMs, failure) {
  const deadline = deps.now() + timeoutMs
  while (!done()) {
    if (deps.now() >= deadline) {
      throw new Error(failure)
    }
    await deps.sleep(POLL_MS)
  }
}

// Asks Pilot to quit and waits for its main process, that instance's own helpers and the automations
// database to be released. Never force-kills. Returns true when Pilot was running.
export async function quitPilot(deps, timeoutMs = EXIT_TIMEOUT_MS) {
  const mains = mainPids(deps)
  if (mains.length === 0) {
    return false
  }
  const helpers = mains.flatMap((pid) => helperPids(deps, pid))
  deps.log('Quitting the running Pilot…')
  deps.run('osascript', ['-e', `tell application id "${BUNDLE_ID}" to quit`])
  await waitUntil(
    deps,
    () => !isRunning(deps),
    timeoutMs,
    `Pilot is still running after ${timeoutMs / 1000}s. Quit it yourself (it may be asking to save or confirm), then build again.`
  )
  await waitUntil(
    deps,
    () => !helpers.some((pid) => alive(deps, pid)),
    timeoutMs,
    `Pilot's helper processes are still running after ${timeoutMs / 1000}s (pids ${helpers.join(', ')}). Quit them yourself, then build again.`
  )
  await waitUntil(
    deps,
    () => !holdsDb(deps),
    timeoutMs,
    `Something still holds pilot-automations.db after ${timeoutMs / 1000}s (see lsof). Close it, then build again.`
  )
  return true
}

function runOrThrow(deps, cmd, args) {
  const r = deps.run(cmd, args)
  if (r.code !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`)
  }
}

// Why replace, not merge: ditto into an existing bundle keeps every file older builds left behind,
// and those extras break the bundle's code seal, which macOS needs to deliver its notifications.
export function copyApp(deps, source) {
  const staging = `${INSTALL_PATH}.installing`
  deps.run('rm', ['-rf', staging])
  runOrThrow(deps, 'ditto', [source, staging])
  // A partial removal would make mv nest the new bundle inside the old one.
  runOrThrow(deps, 'rm', ['-rf', INSTALL_PATH])
  runOrThrow(deps, 'mv', [staging, INSTALL_PATH])
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

export function traceFile(home) {
  return join(logPath(home), 'main.trace.ndjson')
}

// The newest "startup stuck in" event in the trace's last 50 lines, plus what to do by hand.
export function stuckReport(deps) {
  const tail = deps.run('tail', ['-n', '50', traceFile(deps.home)])
  const event =
    tail.code === 0
      ? tail.stdout.split('\n').findLast((l) => l.includes('startup stuck in'))
      : undefined
  const pid = mainPids(deps)[0] ?? '<pid>'
  return [
    event
      ? `Last startup event: ${event}`
      : `No "startup stuck in" event in ${traceFile(deps.home)}.`,
    'Nothing was killed. To recover:',
    `  1. sample ${pid} 2`,
    `  2. kill -9 ${pid}`,
    '  3. rerun with --no-install, or relaunch /Applications/Pilot.app'
  ].join('\n')
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
  const wasRunning = await quitPilot(deps)
  copyApp(deps, source)
  linkCli(deps)
  registerApp(deps)
  if (!launch) {
    return `Installed at: ${INSTALL_PATH} (not launched)`
  }
  if (wasRunning) {
    await deps.sleep(RELAUNCH_PAUSE_MS)
  }
  launchApp(deps, parentEnv)
  let automations
  try {
    automations = await waitForCli(deps, CLI_TIMEOUT_MS, parentEnv)
  } catch (error) {
    throw new Error(`${error.message}\n${stuckReport(deps)}`, { cause: error })
  }
  return summary({ commit: buildCommit(deps, repo), automations })
}
