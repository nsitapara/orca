import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { PilotStatus } from '../shared/api-types'

// Why: the in-app "Install CLI" writes ORCA_CLI_INSTALL_PATH (default /usr/local/bin/orca). Pilot must
// install `pilot` and never overwrite real Orca's `orca` command.
export function applyPilotEnvDefaults(env: NodeJS.ProcessEnv = process.env): void {
  env.ORCA_CLI_INSTALL_PATH ??= '/usr/local/bin/pilot'
}

// Where a Pilot main process runs: the packaged app, `pnpm dev`, a serve (`--serve`), or headless orcad.
export type PilotHostKind = 'desktop' | 'dev' | 'serve' | 'orcad'

// Only one Pilot may tick a folder of automations. A second one (a dev app, a serve on another
// profile) has its own empty `handled` table, so its first loop would start agents on every item.
// PILOT_SCHEDULER=on or =off decides everywhere; unset (or any other value), only the packaged
// desktop app ticks.
export function pilotSchedulerEnabled(
  host: PilotHostKind,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  if (env.PILOT_SCHEDULER === 'on') {
    return true
  }
  if (env.PILOT_SCHEDULER === 'off') {
    return false
  }
  return host === 'desktop'
}

export function pilotAutomationDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.PILOT_AUTOMATION_DIRS?.trim()
  if (!raw) {
    return [join(homedir(), '.pilot', 'automations')]
  }
  return raw
    .split(':')
    .filter(Boolean)
    .map((d) => d.replace(/^~(?=\/|$)/, homedir()))
}

// orcad's own defaults when ORCA_USER_DATA is unset (orcad-app-paths.ts): real Orca's headless folder.
function orcaHeadlessDefaults(env: NodeJS.ProcessEnv, home: string): string[] {
  const dirs = [join(home, '.orca')]
  if (env.XDG_DATA_HOME) {
    dirs.push(join(env.XDG_DATA_HOME, 'Orca'))
  }
  return dirs.map((d) => resolve(d))
}

// Where Pilot keeps pilot-automations.db. The desktop uses Pilot's own userData. orcad defaults to
// real Orca's ~/.orca, which Pilot must never write into, so it uses ORCA_USER_DATA when that is
// set and ~/.pilot/orcad otherwise. The last branch only runs when a test swaps orcad's resolver.
export function pilotDataDir(
  processKind: PilotStatus['process'],
  userData: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  if (processKind === 'main') {
    return userData
  }
  if (env.ORCA_USER_DATA) {
    return env.ORCA_USER_DATA
  }
  if (orcaHeadlessDefaults(env, home).includes(resolve(userData))) {
    return join(home, '.pilot', 'orcad')
  }
  return userData
}

// Where the vault's job folders live (Agent Work/Automations). PILOT_VAULT_EXPORT=off turns the export off.
export function pilotVaultAutomationsDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string | null {
  if (env.PILOT_VAULT_EXPORT === 'off') {
    return null
  }
  const raw = env.PILOT_VAULT_AUTOMATIONS?.trim()
  if (raw) {
    return raw.replace(/^~(?=\/|$)/, home)
  }
  return join(home, 'Documents', 'WebPortal', 'Agent Work', 'Automations')
}

function expandHome(path: string, home: string): string {
  return path.replace(/^~(?=\/|$)/, home)
}

// Where cards' Details bundles must live (vault.AUTOMATIONS): the same folder as the export's, but read
// even when PILOT_VAULT_EXPORT=off, since a Pilot run writes its bundles there either way.
export function pilotDetailsRoot(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  const raw = env.PILOT_VAULT_AUTOMATIONS?.trim()
  if (raw) {
    return expandHome(raw, home)
  }
  return join(home, 'Documents', 'WebPortal', 'Agent Work', 'Automations')
}

// Where job 08 wrote the token usage report; Pilot writes the same files there once 08 hands it over.
export function pilotUsageReportDir(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string {
  const raw = env.PILOT_USAGE_REPORT_DIR?.trim()
  if (raw) {
    return expandHome(raw, home)
  }
  return join(
    home,
    'Documents',
    'WebPortal',
    'Agent Work',
    'Automations',
    '08 · Tally token usage by job'
  )
}

const DEV_RESOURCES = 'src/packages/pilot/resources'

// Pilot's own static files: Contents/Resources/pilot when packaged (electron-builder.config.cjs ships them there),
// else the repo's src/packages/pilot/resources.
export function pilotResourcesDir(opts: {
  packaged: boolean
  resourcesPath: string | undefined
  appPath: string
}): string {
  if (opts.packaged && typeof opts.resourcesPath === 'string') {
    return join(opts.resourcesPath, 'pilot')
  }
  return join(opts.appPath, DEV_RESOURCES)
}

// The token report's HTML page, copied beside the data as Token usage.html. Null where Pilot has no resources folder
// (orcad) and PILOT_USAGE_TEMPLATE names none: the report is then written without its page.
export function pilotUsageTemplate(
  env: NodeJS.ProcessEnv = process.env,
  resourcesDir: string | null = null,
  home: string = homedir()
): string | null {
  const raw = env.PILOT_USAGE_TEMPLATE?.trim()
  if (raw) {
    return expandHome(raw, home)
  }
  return resourcesDir === null ? null : join(resourcesDir, 'usage_report.html')
}
