#!/usr/bin/env node
// `pnpm dev` as Pilot: own data folder and dock title, so dev Pilot never touches real Orca's data.
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { runInherit } from './run.mjs'

// Why the scheduler is off and the automations folder is the dev app's own: its `handled` table is
// empty, so ticking Nish's real automations would start agents on every item. Callers can still set
// PILOT_SCHEDULER and PILOT_AUTOMATION_DIRS themselves.
export function pilotDevEnv(base, home = homedir()) {
  const dataDir =
    base.ORCA_DEV_USER_DATA_PATH ?? join(home, 'Library/Application Support/pilot-dev')
  return {
    ...base,
    ORCA_DEV_USER_DATA_PATH: dataDir,
    ORCA_DEV_DOCK_TITLE: 'Pilot Dev',
    ORCA_CLI_INSTALL_PATH: base.ORCA_CLI_INSTALL_PATH ?? '/usr/local/bin/pilot-dev',
    PILOT_SCHEDULER: base.PILOT_SCHEDULER ?? 'off',
    PILOT_AUTOMATION_DIRS: base.PILOT_AUTOMATION_DIRS ?? join(dataDir, 'automations')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const env = pilotDevEnv(process.env)
  // Pilot watches only folders that exist when it starts.
  if (!process.env.PILOT_AUTOMATION_DIRS) {
    mkdirSync(env.PILOT_AUTOMATION_DIRS, { recursive: true })
  }
  process.exit(await runInherit('pnpm', ['dev', ...process.argv.slice(2)], { env }))
}
