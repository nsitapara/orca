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
        peopleError: null,
        error: null,
        loopStartedAt: null,
        lastLoopFinishedAt: null
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

  it("adds why Pilot couldn't start and the people.yaml note, when there are any", () => {
    const out = formatPilotStatus({
      version: '0.1.0',
      process: 'orcad',
      dataPath: '/d',
      automationDirs: ['/a'],
      missingDirs: [],
      peopleError: '/a/people.yaml: people.yaml and people.yml both exist; using people.yaml',
      error: 'file is not a database',
      loopStartedAt: null,
      lastLoopFinishedAt: null
    })
    expect(out.split('\n').slice(-2)).toEqual([
      "Pilot couldn't start: file is not a database",
      'People: /a/people.yaml: people.yaml and people.yml both exist; using people.yaml'
    ])
  })
})
