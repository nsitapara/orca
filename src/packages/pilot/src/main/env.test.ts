import { describe, expect, it } from 'vitest'
import {
  pilotDataDir,
  pilotDetailsRoot,
  pilotSchedulerEnabled,
  pilotUsageReportDir,
  pilotUsageTemplate,
  pilotVaultAutomationsDir,
  type PilotHostKind
} from './env'

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

describe('pilotSchedulerEnabled', () => {
  // One Pilot ticks a folder of automations. Unset, that is the packaged desktop app only.
  const HOSTS: PilotHostKind[] = ['desktop', 'dev', 'serve', 'orcad']
  it.each([
    [undefined, [true, false, false, false]],
    ['on', [true, true, true, true]],
    ['off', [false, false, false, false]],
    // Anything else reads as unset, so a typo never turns a second Pilot on.
    ['ON', [true, false, false, false]],
    ['1', [true, false, false, false]]
  ] as const)('PILOT_SCHEDULER=%s → desktop, dev, serve, orcad: %j', (value, expected) => {
    const env = value === undefined ? {} : { PILOT_SCHEDULER: value }
    expect(HOSTS.map((h) => pilotSchedulerEnabled(h, env))).toEqual(expected)
  })
})

describe('pilotVaultAutomationsDir', () => {
  it.each([
    [{}, '/h/Documents/WebPortal/Agent Work/Automations'],
    [{ PILOT_VAULT_AUTOMATIONS: '~/vault/Automations' }, '/h/vault/Automations'],
    [{ PILOT_VAULT_EXPORT: 'off' }, null]
  ])('%j → %s', (env, expected) => expect(pilotVaultAutomationsDir(env, '/h')).toBe(expected))
})

// Details are read from the same folder whether or not the vault export runs.
describe('pilotDetailsRoot', () => {
  it.each([
    [{}, '/h/Documents/WebPortal/Agent Work/Automations'],
    [{ PILOT_VAULT_AUTOMATIONS: '~/vault/Automations' }, '/h/vault/Automations'],
    [{ PILOT_VAULT_EXPORT: 'off' }, '/h/Documents/WebPortal/Agent Work/Automations'],
    [
      { PILOT_VAULT_EXPORT: 'off', PILOT_VAULT_AUTOMATIONS: ' /srv/Automations ' },
      '/srv/Automations'
    ]
  ])('%j → %s', (env, expected) => expect(pilotDetailsRoot(env, '/h')).toBe(expected))
})

describe('usage report locations', () => {
  it.each([
    [
      {},
      '/h/Documents/WebPortal/Agent Work/Automations/08 · Tally token usage by job',
      '/h/.agents/skills/worktree-gate/usage_report.html'
    ],
    [{ PILOT_USAGE_REPORT_DIR: '~/r', PILOT_USAGE_TEMPLATE: '/t.html' }, '/h/r', '/t.html']
  ])('%o', (env, dir, template) => {
    expect(pilotUsageReportDir(env, '/h')).toBe(dir)
    expect(pilotUsageTemplate(env, '/h')).toBe(template)
  })
})
