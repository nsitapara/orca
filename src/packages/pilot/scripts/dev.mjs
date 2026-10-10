#!/usr/bin/env node
// `pnpm dev` as Pilot: own data folder and dock title, so dev Pilot never touches real Orca's data.
import { homedir } from 'node:os'
import { join } from 'node:path'
import { runInherit } from './run.mjs'

const env = {
  ...process.env,
  ORCA_DEV_USER_DATA_PATH:
    process.env.ORCA_DEV_USER_DATA_PATH ?? join(homedir(), 'Library/Application Support/pilot-dev'),
  ORCA_DEV_DOCK_TITLE: 'Pilot Dev',
  ORCA_CLI_INSTALL_PATH: '/usr/local/bin/pilot-dev'
}
process.exit(await runInherit('pnpm', ['dev', ...process.argv.slice(2)], { env }))
