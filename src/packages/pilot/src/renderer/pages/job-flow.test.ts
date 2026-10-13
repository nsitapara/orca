import { describe, expect, it } from 'vitest'
import type { ActivityTick, AutomationSummary } from '../../shared/api-types'
import type { FeedDef, JobDef } from '../../shared/definition/types'
import type { JobGroup } from '../../shared/job-stages'
import { summary } from './fixtures'
import { flowEdges, mergeJobActivity, yamlDescription } from './job-flow'

function stage(id: string, job: Partial<JobDef> & { stage: number }): AutomationSummary {
  return {
    ...summary,
    id,
    job: { id: '13', name: null, label: id, feeds: [], ...job }
  }
}
const arrow = (to: string, caption: string | null = null): FeedDef => ({
  to,
  pass: null,
  run: 'next_schedule',
  when: 'success',
  caption
})
const group = (...stages: AutomationSummary[]): JobGroup => ({
  kind: 'job',
  id: '13',
  name: 'Fix red hourly e2e on dev',
  stages
})

describe('flowEdges: the arrows the job page draws, from feeds', () => {
  it('turns each feeds connection into an edge between stage numbers, with its own caption', () => {
    const job = group(
      stage('a', { stage: 1, feeds: [arrow('b', 'the tickets it opens'), arrow('c')] }),
      stage('b', { stage: 2 }),
      stage('c', { stage: 3 })
    )
    expect(flowEdges(job)).toEqual([
      { from: 1, to: 2, caption: 'the tickets it opens' },
      { from: 1, to: 3, caption: null }
    ])
  })

  it('draws nothing for stages that feed nothing, or a target that is not loaded', () => {
    expect(flowEdges(group(stage('a', { stage: 1 }), stage('b', { stage: 2 })))).toEqual([])
    expect(flowEdges(group(stage('a', { stage: 1, feeds: [arrow('gone')] })))).toEqual([])
  })
})

function tick(id: number, automationId: string, startedAt: number): ActivityTick {
  return {
    id,
    automationId,
    startedAt,
    finishedAt: startedAt + 1,
    dryRun: true,
    status: 'ok',
    error: null,
    counts: {},
    items: [],
    runs: []
  }
}

describe('mergeJobActivity: one timeline for the job', () => {
  it('merges every stage’s ticks newest first, each with its stage and that stage’s check names', () => {
    const merged = mergeJobActivity([
      { stage: 1, checkNames: ['Quota'], ticks: [tick(9, 'a', 300), tick(5, 'a', 100)] },
      {
        stage: 2,
        checkNames: ['Quota', 'Check pilot_mode.py'],
        ticks: [tick(8, 'b', 200), tick(10, 'b', 300)]
      }
    ])
    expect(merged.map((m) => [m.tick.id, m.stage])).toEqual([
      [10, 2],
      [9, 1],
      [8, 2],
      [5, 1]
    ])
    expect(merged[0].checkNames).toEqual(['Quota', 'Check pilot_mode.py'])
  })
})

describe('yamlDescription: the one-line description a stage card shows', () => {
  it.each([
    ['# Opens one ticket per red run.\n# More detail.\nname: x\n', 'Opens one ticket per red run.'],
    ['\n#   Spaced out.  \nname: x\n', 'Spaced out.'],
    ['name: x\n# a comment later\n', null],
    ['#\n# \nname: x\n', null]
  ])('%j', (yaml, description) => {
    expect(yamlDescription(yaml)).toBe(description)
  })
})
