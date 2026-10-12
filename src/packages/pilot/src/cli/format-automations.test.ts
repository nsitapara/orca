import { describe, expect, it } from 'vitest'
import type { AutomationDetailPayload, AutomationSummary } from '../shared/api-types'
import { formatAutomationDetail, formatAutomationList } from './format-automations'

const fix = {
  id: 'fix-failed-ci',
  name: 'Fix failed CI on my MRs',
  file: '/a/fix-failed-ci.yaml',
  enabled: false,
  schedule: '10 * * * *',
  timezone: 'America/Los_Angeles',
  itemKind: 'Merge requests',
  agent: 'claude',
  powers: ['commit', 'push'],
  inbox: '{mr.author}',
  nextTickAt: null,
  lastTick: null
} as AutomationSummary
const pull = {
  ...fix,
  id: 'pull-dev',
  name: 'Pull latest dev',
  enabled: true,
  schedule: 'manual'
} as AutomationSummary

describe('formatAutomationList', () => {
  it('prints one aligned line per automation, then bad files, missing folders and the people note', () => {
    expect(
      formatAutomationList({
        automations: [fix, pull],
        errors: [
          { file: '/a/bad.yaml', errors: ['/a/bad.yaml: no steps', '/a/bad.yaml: bad schedule'] }
        ],
        peopleError: 'people.yaml and people.yml both exist',
        missingDirs: ['/gone']
      })
    ).toBe(
      [
        'off  fix-failed-ci  10 * * * * (America/Los_Angeles)  Fix failed CI on my MRs',
        'on   pull-dev       run by hand  Pull latest dev',
        'error /a/bad.yaml: /a/bad.yaml: no steps · /a/bad.yaml: bad schedule',
        'missing folder /gone',
        'people: people.yaml and people.yml both exist'
      ].join('\n')
    )
  })

  it('says so when there are none', () => {
    expect(
      formatAutomationList({ automations: [], errors: [], peopleError: null, missingDirs: [] })
    ).toBe('No automations found.')
  })
})

describe('formatAutomationDetail', () => {
  it('prints the summary, then the YAML', () => {
    const detail: AutomationDetailPayload = {
      summary: fix,
      yaml: 'name: Fix failed CI on my MRs\n',
      checkNames: ['Worktree', 'Clean'],
      steps: []
    }
    expect(formatAutomationDetail(detail)).toBe(
      [
        'Fix failed CI on my MRs (fix-failed-ci)',
        'File: /a/fix-failed-ci.yaml',
        'Schedule: 10 * * * * (America/Los_Angeles)',
        'Status: Paused',
        'Next tick: —',
        'Checks: Worktree, Clean',
        '',
        'name: Fix failed CI on my MRs'
      ].join('\n')
    )
  })
})
