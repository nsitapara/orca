import { describe, expect, it } from 'vitest'
import { bridgeEnv } from './act-bridge'

describe('bridgeEnv', () => {
  it("marks Pilot's own Python helper and never passes a run id it would route back", () => {
    const env = bridgeEnv({ PATH: '/bin', PILOT_RUN_ID: 'x' }, 'ci-1')
    expect(env).toEqual({ PATH: '/bin', PILOT_BRIDGE: '1', AGENT_RUN: 'ci-1' })
  })

  // H9: the helper (and what it runs) reaches Pilot's own `pilot`/`orca` launchers and data folder.
  it("puts Pilot's bin folder first on PATH and sets its data folder", () => {
    const env = bridgeEnv({ PATH: '/bin', HOME: '/h' }, 'ci-1', {
      binDir: '/pilot/bin',
      dataDir: '/data/pilot'
    })
    expect(env).toEqual({
      PATH: '/pilot/bin:/bin',
      HOME: '/h',
      ORCA_USER_DATA_PATH: '/data/pilot',
      PILOT_BRIDGE: '1',
      AGENT_RUN: 'ci-1'
    })
  })
})
