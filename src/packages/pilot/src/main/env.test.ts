import { describe, expect, it } from 'vitest'
import { pilotDataDir } from './env'

const HOME = '/h'

describe('pilotDataDir', () => {
  // Pilot never writes into real Orca's headless folder (~/.orca, or $XDG_DATA_HOME/Orca).
  it.each([
    [
      'desktop: its own userData',
      'main',
      '/h/Library/Application Support/pilot',
      {},
      '/h/Library/Application Support/pilot'
    ],
    [
      'orcad: ORCA_USER_DATA set explicitly',
      'orcad',
      '/srv/pilot',
      { ORCA_USER_DATA: '/srv/pilot' },
      '/srv/pilot'
    ],
    ["orcad: orcad's default ~/.orca", 'orcad', '/h/.orca', {}, '/h/.pilot/orcad'],
    [
      'orcad: an empty ORCA_USER_DATA is unset',
      'orcad',
      '/h/.orca',
      { ORCA_USER_DATA: '' },
      '/h/.pilot/orcad'
    ],
    ["orcad: orcad's XDG default", 'orcad', '/x/Orca', { XDG_DATA_HOME: '/x' }, '/h/.pilot/orcad'],
    ['orcad: a resolver swapped in by a test', 'orcad', '/tmp/t', {}, '/tmp/t']
  ] as const)('%s', (_name, kind, userData, env, expected) => {
    expect(pilotDataDir(kind, userData, env, HOME)).toBe(expected)
  })
})
