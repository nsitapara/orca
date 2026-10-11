import { describe, expect, it } from 'vitest'
import type { ActivityTick, ItemDecision } from '../shared/api-types'
import { formatActivity, formatDecisions, formatPilotStatus } from './format'

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

function decision(
  key: string,
  label: string,
  verdict: ItemDecision['verdict'],
  reason: string
): ItemDecision {
  return { key, label, verdict, reason, checks: [], onceKey: `${key}:9`, fields: {} }
}

describe('formatPilotStatus scheduler passes', () => {
  it('shows when a pass started and last finished, only when known', () => {
    const status = {
      version: '0.1.0',
      process: 'main' as const,
      dataPath: '/d',
      automationDirs: [],
      missingDirs: [],
      peopleError: null,
      error: null,
      loopStartedAt: 1_700_000_100_000,
      lastLoopFinishedAt: 1_700_000_000_000
    }
    const lines = formatPilotStatus(status).split('\n')
    expect(lines.filter((l) => l.startsWith('Scheduler pass started'))).toHaveLength(1)
    expect(lines.filter((l) => l.startsWith('Last pass finished'))).toHaveLength(1)
    const none = formatPilotStatus({ ...status, loopStartedAt: null, lastLoopFinishedAt: null })
    expect(none).not.toContain('pass')
  })
})

describe('formatDecisions', () => {
  it('prints one aligned line per item with its verdict and reason', () => {
    const text = formatDecisions({
      tickId: 3,
      status: 'ok',
      error: null,
      decisions: [
        decision('!1561', '!1561 web-1493', 'started', 'All checks pass'),
        decision('!1574', '!1574 web-1474', 'skipped', '2 uncommitted files')
      ]
    })
    expect(text).toBe(
      [
        'Tick 3 · ok',
        '  started   !1561 web-1493  All checks pass',
        '  skipped   !1574 web-1474  2 uncommitted files'
      ].join('\n')
    )
  })

  it('says so when a tick found no items', () => {
    expect(formatDecisions({ tickId: 5, status: 'ok', error: null, decisions: [] })).toBe(
      'Tick 5 · ok\n  No items.'
    )
  })

  it('prints the error of a failed tick', () => {
    expect(
      formatDecisions({ tickId: 4, status: 'failed', error: 'glab: 502', decisions: [] })
    ).toBe('Tick 4 · failed: glab: 502')
  })

  it.each([
    [{ status: 'busy' as const }, 'Tick already running for fix-ci'],
    [{ status: 'unknown' as const }, 'No automation fix-ci']
  ])('explains %j', (outcome, text) => {
    expect(formatDecisions(outcome, 'fix-ci')).toBe(text)
  })
})

describe('formatActivity', () => {
  const base = {
    automationId: 'a',
    finishedAt: 2,
    error: null,
    counts: {},
    items: [],
    runs: []
  }
  const run = {
    id: 'r1',
    automationId: 'a',
    tickId: 7,
    itemKey: '!1',
    itemLabel: '!1 x',
    worktreePath: null,
    startedAt: 1,
    finishedAt: 2,
    costUsd: null,
    tokens: null,
    worktreeId: null,
    trigger: 'schedule' as const,
    parentRunId: null,
    imported: false,
    steps: []
  }

  it('says so when there is no activity', () => {
    expect(formatActivity([])).toBe('No activity yet.')
  })

  it('lists ticks as given (newest first) with items and runs', () => {
    const ticks: ActivityTick[] = [
      {
        ...base,
        id: 8,
        startedAt: 1_700_000_100_000,
        dryRun: true,
        status: 'ok',
        items: [
          {
            tickId: 8,
            itemKey: '!1',
            label: '!1 x',
            verdict: 'skipped',
            reason: 'dirty',
            checks: [],
            fields: {},
            runId: null
          }
        ]
      },
      {
        ...base,
        id: 7,
        startedAt: 1_700_000_000_000,
        dryRun: false,
        status: 'failed',
        error: 'glab: 502',
        items: [
          {
            tickId: 7,
            itemKey: '!1',
            label: '!1 x',
            verdict: 'started',
            reason: 'All checks pass',
            checks: [],
            fields: {},
            runId: 'r1'
          }
        ],
        runs: [{ ...run, status: 'failed', outcome: "Couldn't start: no terminal" }]
      }
    ]
    const lines = formatActivity(ticks).split('\n')
    expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d · tick 8 · dry run · ok$/)
    expect(lines.slice(1, 2)).toEqual(['  skipped  !1 x  dirty'])
    expect(lines[2]).toMatch(/ · tick 7 · failed: glab: 502$/)
    expect(lines.slice(3)).toEqual([
      '  started  !1 x  All checks pass',
      "  run r1 · failed · Couldn't start: no terminal"
    ])
  })
})
