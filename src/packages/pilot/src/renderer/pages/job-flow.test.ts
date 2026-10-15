import { describe, expect, it } from 'vitest'
import type { AutomationSummary, HandoverRow } from '../../shared/api-types'
import type { FeedDef, JobDef } from '../../shared/definition/types'
import type { JobGroup } from '../../shared/job-stages'
import { summary } from './fixtures'
import { flowEdges, yamlDescription } from './job-flow'

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
  caption,
  trust: 'shell'
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
      { from: 1, to: 2, caption: 'the tickets it opens', last: [] },
      { from: 1, to: 3, caption: null, last: [] }
    ])
  })

  it('carries the most recent handover along each edge', () => {
    const job = group(stage('a', { stage: 1, feeds: [arrow('b')] }), stage('b', { stage: 2 }))
    const rows = [{ itemId: 'WEB-1' } as HandoverRow]
    const latest = (from: string, to: string) => (from === 'a' && to === 'b' ? rows : [])
    expect(flowEdges(job, latest)).toEqual([{ from: 1, to: 2, caption: null, last: rows }])
  })

  it('draws nothing for stages that feed nothing, or a target that is not loaded', () => {
    expect(flowEdges(group(stage('a', { stage: 1 }), stage('b', { stage: 2 })))).toEqual([])
    expect(flowEdges(group(stage('a', { stage: 1, feeds: [arrow('gone')] })))).toEqual([])
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
