import { describe, expect, it } from 'vitest'
import type { ReportBucketRow } from '../store/store-spend'
import {
  buildUsageReport,
  jobResolver,
  localIsoMinute,
  localIsoSeconds,
  NOT_COUNTED,
  type UsageRow
} from './report'

const at = (h: number, m = 0, s = 0): number => new Date(2026, 9, 11, h, m, s).getTime()
const LEGACY_JOBS = [
  { key: 'ci-fix-sweep', name: '05 · Fix failed CI on my MRs' },
  { key: 'sync-dev', name: '01 · Pull latest dev into local dev' }
]
const AUTOMATIONS = [
  { id: 'fix-failed-ci', name: 'Fix failed CI on my MRs' },
  { id: 'pull-dev', name: '01 · Pull latest dev into local dev' },
  { id: 'new-thing', name: 'Brand new thing' }
]

describe('local times', () => {
  it('match Python isoformat: minutes for rows, seconds and offset for generated_at', () => {
    expect(localIsoMinute(at(10, 5))).toBe('2026-10-11T10:05')
    expect(localIsoSeconds(at(10, 5, 3))).toMatch(/^2026-10-11T10:05:03[+-]\d\d:\d\d$/)
  })
})

describe('jobResolver', () => {
  it.each([
    ['fix-failed-ci', { key: 'ci-fix-sweep', name: '05 · Fix failed CI on my MRs' }],
    ['pull-dev', { key: 'sync-dev', name: '01 · Pull latest dev into local dev' }],
    ['new-thing', { key: 'new-thing', name: 'Brand new thing' }],
    ['deleted-yaml', { key: 'deleted-yaml', name: 'deleted-yaml' }]
  ])('%s', (id, expected) => {
    expect(jobResolver(AUTOMATIONS, LEGACY_JOBS)(id)).toEqual(expected)
  })
})

const bucket = (over: Partial<ReportBucketRow>): ReportBucketRow => ({
  automationId: 'fix-failed-ci',
  itemLabel: '!1561 web-1493',
  worktreePath: '/Users/me/web-platform/worktrees/web-1493',
  agent: 'claude',
  sessionId: 'p1',
  stepStartedAt: at(10, 10),
  day: '2026-10-11',
  model: 'claude-opus-5-5',
  requests: 2,
  input: 10,
  cacheRead: 100,
  cacheWrite: 5,
  output: 3,
  costUsd: 0.25,
  ...over
})

const legacyRow = (session: string): UsageRow => ({
  day: '2026-10-01',
  job: 'ci-fix-sweep',
  job_name: '05 · Fix failed CI on my MRs',
  source: 'tab',
  agent: 'claude',
  model: 'claude-opus-5-5',
  session,
  worktree: 'web-1',
  cwd: '/w/web-1',
  started: '2026-10-01T09:10',
  title: 'CI fix',
  requests: 1,
  input: 1,
  cache_read: 1,
  cache_write: 1,
  output: 1,
  tokens: 4,
  cost_usd: 0.01
})

describe('buildUsageReport', () => {
  const report = buildUsageReport({
    buckets: [
      bucket({}),
      bucket({
        stepStartedAt: at(10, 40),
        requests: 1,
        input: 5,
        cacheRead: 0,
        cacheWrite: 0,
        output: 1,
        costUsd: 0.5
      }),
      bucket({ automationId: 'new-thing', sessionId: 'p2', model: 'mystery', costUsd: null })
    ],
    sessionless: [
      {
        automationId: 'pull-dev',
        agent: 'codex',
        startedAt: at(9),
        worktreePath: '/Users/me/web-platform',
        itemLabel: 'web-platform'
      }
    ],
    pending: 2,
    automations: AUTOMATIONS,
    legacy: { jobs: LEGACY_JOBS, rows: [legacyRow('old'), legacyRow('p1')], gaps: [] },
    now: at(10, 50)
  })

  it('keeps the legacy history but replaces a legacy session Pilot measured itself', () => {
    expect(report.rows.map((r) => r.session)).toEqual(['old', 'p1', 'p2'])
  })

  it('merges one session used by two steps into one row per day and model', () => {
    expect(report.rows[1]).toEqual({
      day: '2026-10-11',
      job: 'ci-fix-sweep',
      job_name: '05 · Fix failed CI on my MRs',
      source: 'pilot',
      agent: 'claude',
      model: 'claude-opus-5-5',
      session: 'p1',
      worktree: 'web-1493',
      cwd: '/Users/me/web-platform/worktrees/web-1493',
      started: '2026-10-11T10:10',
      title: '!1561 web-1493',
      requests: 3,
      input: 15,
      cache_read: 100,
      cache_write: 5,
      output: 4,
      tokens: 124,
      cost_usd: 0.75
    })
  })

  it('lists the legacy jobs, then the jobs only Pilot has; gaps, pending and unpriced models', () => {
    expect(report.jobs.map((j) => j.key)).toEqual(['ci-fix-sweep', 'sync-dev', 'new-thing'])
    expect(report.gaps).toEqual([
      {
        job: 'sync-dev',
        job_name: '01 · Pull latest dev into local dev',
        source: 'pilot',
        agent: 'codex',
        at: '2026-10-11T09:00',
        worktree: 'web-platform',
        title: 'web-platform'
      }
    ])
    expect(report).toMatchObject({
      pending: 2,
      unpriced_models: ['mystery'],
      not_counted: NOT_COUNTED
    })
    expect(Object.keys(report)).toEqual([
      'generated_at',
      'price_note',
      'jobs',
      'rows',
      'pending',
      'gaps',
      'unpriced_models',
      'not_counted'
    ])
  })

  it('works with no legacy file: Pilot rows only', () => {
    const fresh = buildUsageReport({
      buckets: [bucket({})],
      sessionless: [],
      pending: 0,
      automations: AUTOMATIONS,
      legacy: null,
      now: at(11)
    })
    expect(fresh.rows.map((r) => [r.job, r.job_name])).toEqual([
      ['fix-failed-ci', 'Fix failed CI on my MRs']
    ])
  })

  it('gives every row of a session spanning days the session earliest start, title and cwd', () => {
    const r = buildUsageReport({
      buckets: [
        bucket({
          day: '2026-10-12',
          stepStartedAt: at(10, 40),
          itemLabel: 'later step',
          worktreePath: '/w/later'
        }),
        bucket({
          day: '2026-10-11',
          stepStartedAt: at(10, 10),
          itemLabel: 'first step',
          worktreePath: '/w/first'
        }),
        bucket({
          day: '2026-10-12',
          stepStartedAt: at(10, 10),
          itemLabel: 'first step',
          worktreePath: '/w/first'
        })
      ],
      sessionless: [],
      pending: 0,
      automations: AUTOMATIONS,
      legacy: null,
      now: at(11)
    })
    expect(r.rows.map((x) => [x.day, x.started, x.title, x.cwd])).toEqual([
      ['2026-10-11', '2026-10-11T10:10', 'first step', '/w/first'],
      ['2026-10-12', '2026-10-11T10:10', 'first step', '/w/first']
    ])
  })

  it('adds the raw costs of merged buckets and rounds once', () => {
    const tiny = { costUsd: 4e-7 }
    const r = buildUsageReport({
      buckets: [bucket(tiny), bucket(tiny), bucket(tiny)],
      sessionless: [],
      pending: 0,
      automations: AUTOMATIONS,
      legacy: null,
      now: at(11)
    })
    expect(r.rows[0].cost_usd).toBe(0.000001)
  })
})
