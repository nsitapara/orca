import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { PilotStatus } from '../shared/api-types'

// Why: the in-app "Install CLI" writes ORCA_CLI_INSTALL_PATH (default /usr/local/bin/orca). Pilot must
// install `pilot` and never overwrite real Orca's `orca` command.
export function applyPilotEnvDefaults(env: NodeJS.ProcessEnv = process.env): void {
  env.ORCA_CLI_INSTALL_PATH ??= '/usr/local/bin/pilot'
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
