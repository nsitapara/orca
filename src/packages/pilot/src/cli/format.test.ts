import { describe, expect, it } from 'vitest'
import { formatPilotStatus } from './format'

describe('formatPilotStatus', () => {
  it('prints version, process, data path and folders, flagging missing ones', () => {
    expect(
      formatPilotStatus({
        version: '0.1.0',
        process: 'main',
        dataPath: '/Users/n/Library/Application Support/pilot',
        automationDirs: ['/Users/n/.agents/automations', '/Users/n/.pilot/automations'],
        missingDirs: ['/Users/n/.pilot/automations'],
        peopleError: null
      })
    ).toBe(
      [
        'Pilot 0.1.0 (main)',
        'Data: /Users/n/Library/Application Support/pilot',
        'Automation folders:',
        '  /Users/n/.agents/automations',
        '  /Users/n/.pilot/automations (missing)'
      ].join('\n')
    )
  })

  it('adds the people.yaml note when there is one', () => {
    const out = formatPilotStatus({
      version: '0.1.0',
      process: 'orcad',
      dataPath: '/d',
      automationDirs: ['/a'],
      missingDirs: [],
      peopleError: '/a/people.yaml: people.yaml and people.yml both exist; using people.yaml'
    })
    expect(out.split('\n').at(-1)).toBe(
      'People: /a/people.yaml: people.yaml and people.yml both exist; using people.yaml'
    )
  })
})
