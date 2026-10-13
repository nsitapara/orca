import { describe, expect, it } from 'vitest'
import type { AutomationSummary, TickRow } from './api-types'
import type { JobDef } from './definition/types'
import { findJob, jobEnabled, jobLastTick, listEntries } from './job-stages'

function tick(automationId: string, startedAt: number): TickRow {
  return {
    id: startedAt,
    automationId,
    startedAt,
    finishedAt: startedAt + 1,
    dryRun: true,
    status: 'ok',
    error: null,
    counts: {}
  }
}

function summary(id: string, over: Partial<AutomationSummary> = {}): AutomationSummary {
  return {
    id,
    name: id,
    file: `/autos/${id}.yaml`,
    enabled: false,
    schedule: 'manual',
    timezone: 'America/Los_Angeles',
    itemKind: 'Merge requests',
    agent: 'claude',
    powers: [],
    inbox: 'nish',
    nextTickAt: null,
    lastTick: null,
    job: null,
    ...over
  }
}
const job = (over: Partial<JobDef> & { stage: number }): JobDef => ({
  id: '13',
  name: null,
  label: `stage ${over.stage}`,
  feeds: [],
  handsOver: null,
  ...over
})

const PIPELINES = summary('dev-e2e-fix', {
  name: '13 · Fix red hourly e2e on dev',
  itemKind: 'Pipelines',
  job: job({ stage: 1, name: 'Fix red hourly e2e on dev', feeds: ['dev-e2e-fix-start'] }),
  lastTick: tick('dev-e2e-fix', 100)
})
const STARTS = summary('dev-e2e-fix-start', {
  name: '13 · Start fix sessions for red e2e tickets',
  itemKind: 'Linear tickets',
  job: job({ stage: 2 }),
  lastTick: tick('dev-e2e-fix-start', 200)
})

describe('listEntries: the Automations list, a job of several automations as one entry', () => {
  it("shows 13's two stages as one job, in stage order, where its first file is listed", () => {
    const entries = listEntries([
      summary('docker-prune'),
      STARTS,
      PIPELINES,
      summary('fix-failed-ci')
    ])
    expect(entries.map((e) => (e.kind === 'job' ? `job ${e.id}` : e.automation.id))).toEqual([
      'docker-prune',
      'job 13',
      'fix-failed-ci'
    ])
    const group = entries[1]
    expect(group.kind === 'job' && group.name).toBe('Fix red hourly e2e on dev')
    expect(group.kind === 'job' && group.stages.map((s) => s.id)).toEqual([
      'dev-e2e-fix',
      'dev-e2e-fix-start'
    ])
  })

  it('leaves every automation without a job a row of its own, in order', () => {
    const plain = [summary('a'), summary('b'), summary('c')]
    expect(listEntries(plain)).toEqual(
      plain.map((automation) => ({ kind: 'automation', automation }))
    )
  })

  it('keeps a job whose other stage was refused a job of one stage', () => {
    const [entry] = listEntries([STARTS])
    expect(entry.kind === 'job' && entry.stages.map((s) => s.id)).toEqual(['dev-e2e-fix-start'])
    expect(entry.kind === 'job' && entry.name).toBe('13 · Start fix sessions for red e2e tickets')
  })
})

describe('the job’s combined state', () => {
  it('is enabled when any stage is, and its last tick is the newest across stages', () => {
    const group = findJob([PIPELINES, STARTS], '13')!
    expect(jobEnabled(group)).toBe(false)
    expect(jobLastTick(group)?.automationId).toBe('dev-e2e-fix-start')
    const on = findJob([PIPELINES, { ...STARTS, enabled: true, lastTick: null }], '13')!
    expect(jobEnabled(on)).toBe(true)
    expect(jobLastTick(on)?.automationId).toBe('dev-e2e-fix')
    const never = findJob([{ ...STARTS, lastTick: null }], '13')!
    expect(jobLastTick(never)).toBeNull()
  })

  it('finds no job for an id no automation names', () => {
    expect(findJob([PIPELINES, STARTS], '14')).toBeNull()
  })
})
