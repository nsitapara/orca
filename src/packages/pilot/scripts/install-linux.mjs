// Installs the unpacked Linux Pilot (dist/linux-unpacked) under ~/.local/share/pilot-desktop, links `pilot-desktop`,
// and adds the launcher entry. Every shell call goes through deps.run so tests stub them; nothing runs at import.
import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { run } from './run.mjs'

export const DESKTOP_ID = 'dev.nsitapara.pilot'
export const EXIT_TIMEOUT_MS = 30_000
const POLL_MS = 500

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function defaultDeps() {
  return { run, sleep, now: () => Date.now(), log: (m) => console.log(m), home: homedir() }
}

export function paths(home) {
  const share = join(home, '.local', 'share')
  return {
    app: join(share, 'pilot-desktop', 'app'),
    link: join(home, '.local', 'bin', 'pilot-desktop'),
    entry: join(share, 'applications', `${DESKTOP_ID}.desktop`),
    icon: join(share, 'icons', 'hicolor', '1024x1024', 'apps', `${DESKTOP_ID}.png`),
    // Pilot's headless engine (machine-setup/linux-engine.sh): this machine's jobs already tick there.
    engineUnit: join(home, '.config', 'systemd', 'user', 'pilot-engine.service')
  }
}

// off with the engine on this machine: the window shows its work and every paired machine's, and never ticks
// a job a second time. Without it, the window is this machine's Pilot (README, "Scheduler").
export function defaultScheduler(home, exists = existsSync) {
  return exists(paths(home).engineUnit) ? 'off' : null
}

export function desktopEntry({ app, scheduler }) {
  const env = scheduler ? `env PILOT_SCHEDULER=${scheduler} ` : ''
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Pilot',
    'Comment=Automations, Inbox and agent runs across your machines',
    `Exec=${env}"${app}/pilot" %U`,
    `Icon=${DESKTOP_ID}`,
    'Terminal=false',
    'Categories=Development;',
    'MimeType=x-scheme-handler/pilot;',
    // Electron's window class: package.json's name, which Pilot's build makes `pilot`.
    'StartupWMClass=pilot',
    ''
  ].join('\n')
}

function mainProcessPids(deps, app) {
  const r = deps.run('pgrep', ['-f', `^${app}/pilot( |$)`])
  return r.code === 0 ? r.stdout.split('\n').filter(Boolean) : []
}

// Asks a running Pilot to quit (SIGTERM, as a desktop logout does) and waits for it; never force-kills.
async function quitRunning(deps, app) {
  const pids = mainProcessPids(deps, app)
  if (pids.length === 0) {
    return
  }
  deps.log(`Quitting the running Pilot (${pids.join(', ')})…`)
  deps.run('kill', ['-TERM', ...pids])
  const deadline = deps.now() + EXIT_TIMEOUT_MS
  while (mainProcessPids(deps, app).length > 0) {
    if (deps.now() > deadline) {
      throw new Error(`Pilot didn't quit within ${EXIT_TIMEOUT_MS / 1000}s; quit it, then re-run.`)
    }
    await deps.sleep(POLL_MS)
  }
}

export async function installPilotLinux({ source, repo, scheduler }, deps = defaultDeps()) {
  const p = paths(deps.home)
  const chosen = scheduler === undefined ? defaultScheduler(deps.home) : scheduler
  await quitRunning(deps, p.app)
  // Copied beside the old install, then swapped in, so a failed copy leaves the old one runnable.
  const next = `${p.app}.next`
  rmSync(next, { recursive: true, force: true })
  mkdirSync(join(p.app, '..'), { recursive: true })
  cpSync(source, next, { recursive: true, verbatimSymlinks: true })
  rmSync(`${p.app}.old`, { recursive: true, force: true })
  if (existsSync(p.app)) {
    renameSync(p.app, `${p.app}.old`)
  }
  renameSync(next, p.app)
  rmSync(`${p.app}.old`, { recursive: true, force: true })

  mkdirSync(join(p.link, '..'), { recursive: true })
  rmSync(p.link, { force: true })
  symlinkSync(join(p.app, 'resources', 'bin', 'pilot'), p.link)
  mkdirSync(join(p.icon, '..'), { recursive: true })
  cpSync(join(repo, 'resources', 'build', 'icon.png'), p.icon)
  mkdirSync(join(p.entry, '..'), { recursive: true })
  writeFileSync(p.entry, desktopEntry({ app: p.app, scheduler: chosen }))
  // Optional refreshes: launchers that cache entries and icons pick the new ones up without a re-login.
  deps.run('update-desktop-database', [join(p.entry, '..')])
  deps.run('gtk-update-icon-cache', ['-q', '-t', join(p.icon, '..', '..', '..')])

  return [
    `Installed ${p.app}`,
    `Launcher entry: ${p.entry}${chosen ? ` (PILOT_SCHEDULER=${chosen})` : ''}`,
    `CLI: ${p.link}`,
    'Open Pilot from your app launcher.'
  ].join('\n')
}
