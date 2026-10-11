import { describe, expect, it } from 'vitest'
// @ts-expect-error -- .mjs script without type declarations
import { pilotDevEnv } from './dev.mjs'

const DEV_DATA = '/h/Library/Application Support/pilot-dev'

describe('pilotDevEnv', () => {
  it("keeps the dev app off Nish's automations: scheduler off, its own folder", () => {
    expect(pilotDevEnv({ PATH: '/bin' }, '/h')).toEqual({
      PATH: '/bin',
      ORCA_DEV_USER_DATA_PATH: DEV_DATA,
      ORCA_DEV_DOCK_TITLE: 'Pilot Dev',
      ORCA_CLI_INSTALL_PATH: '/usr/local/bin/pilot-dev',
      PILOT_SCHEDULER: 'off',
      PILOT_AUTOMATION_DIRS: `${DEV_DATA}/automations`
    })
  })

  it('keeps what the caller set', () => {
    const env = pilotDevEnv(
      {
        ORCA_DEV_USER_DATA_PATH: '/tmp/d',
        PILOT_SCHEDULER: 'on',
        PILOT_AUTOMATION_DIRS: '/tmp/a'
      },
      '/h'
    )
    expect(env).toMatchObject({
      ORCA_DEV_USER_DATA_PATH: '/tmp/d',
      PILOT_SCHEDULER: 'on',
      PILOT_AUTOMATION_DIRS: '/tmp/a'
    })
  })

  it("puts the default automations folder under the caller's dev data folder", () => {
    expect(pilotDevEnv({ ORCA_DEV_USER_DATA_PATH: '/tmp/d' }, '/h').PILOT_AUTOMATION_DIRS).toBe(
      '/tmp/d/automations'
    )
  })
})
