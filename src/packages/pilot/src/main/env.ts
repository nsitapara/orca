import { homedir } from 'node:os'
import { join } from 'node:path'

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
