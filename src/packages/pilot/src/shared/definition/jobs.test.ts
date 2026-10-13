import { describe, expect, it } from 'vitest'
import { testDefinition } from './__fixtures__/definition'
import { jobProblems } from './jobs'
import { parseAutomationYaml } from './parse'
import type { AutomationDefinition, JobDef } from './types'

const BASE = 'name: n\nrepo: r\nschedule: manual\nsteps:\n  - { agent: claude, prompt: x }\n'

function parsed(job: string) {
  return parseAutomationYaml(`${BASE}job:\n${job}`, '/a/n.yaml')
}
function errorsOf(job: string): string {
  const result = parsed(job)
  return result.ok ? '' : result.errors.map((e) => e.replace('/a/n.yaml: ', '')).join('\n')
}

describe('the job: block', () => {
  it('reads a stage of a job, with feeds as a list and its caption', () => {
    const result = parsed(
      '  id: "13"\n  name: Fix red hourly e2e on dev\n  stage: 1\n  label: Open or update the ticket\n  feeds: dev-e2e-fix-start\n  hands_over: the tickets it opens\n'
    )
    expect(result.ok && result.definition.job).toEqual({
      id: '13',
      name: 'Fix red hourly e2e on dev',
      stage: 1,
      label: 'Open or update the ticket',
      feeds: ['dev-e2e-fix-start'],
      handsOver: 'the tickets it opens'
    })
    const second = parsed('  id: "13"\n  stage: 2\n  label: Start a fix session per ticket\n')
    expect(second.ok && second.definition.job).toEqual({
      id: '13',
      name: null,
      stage: 2,
      label: 'Start a fix session per ticket',
      feeds: [],
      handsOver: null
    })
  })

  it('leaves an automation without the block a job of its own', () => {
    const result = parseAutomationYaml(BASE, '/a/n.yaml')
    expect(result.ok && result.definition.job).toBeNull()
  })

  it.each([
    ['no id', '  stage: 1\n  label: x\n', 'job.id'],
    ['no stage', '  id: "13"\n  label: x\n', 'job.stage'],
    ['no label', '  id: "13"\n  stage: 1\n', 'job.label'],
    ['stage 0', '  id: "13"\n  stage: 0\n  label: x\n', 'job.stage'],
    ['a fractional stage', '  id: "13"\n  stage: 1.5\n  label: x\n', 'job.stage'],
    ['an unquoted number id', '  id: 13\n  stage: 1\n  label: x\n', 'job.id'],
    [
      'the old part key',
      '  id: "13"\n  part: 1\n  stage: 1\n  label: x\n',
      'job: unknown key "part"'
    ],
    [
      'a caption without feeds',
      '  id: "13"\n  stage: 1\n  label: x\n  hands_over: tickets\n',
      'job.hands_over: only with job.feeds (it captions the arrow to the stage it feeds)'
    ]
  ])('refuses %s', (_name, job, error) => {
    expect(errorsOf(job)).toContain(error)
  })
})

function stage(id: string, job: Partial<JobDef> & { stage: number }): AutomationDefinition {
  return testDefinition({
    id,
    file: `/autos/${id}.yaml`,
    job: { id: '13', name: null, label: `${id} label`, feeds: [], handsOver: null, ...job }
  })
}
const PIPELINES = stage('dev-e2e-fix', {
  stage: 1,
  name: 'Fix red hourly e2e on dev',
  feeds: ['dev-e2e-fix-start'],
  handsOver: 'the tickets it opens'
})
const STARTS = stage('dev-e2e-fix-start', { stage: 2 })

describe('jobProblems: rules across every loaded definition', () => {
  it("accepts 13's two stages, and has nothing to say about an automation without a job", () => {
    expect(jobProblems([PIPELINES, STARTS, testDefinition({ id: 'solo' })])).toEqual(new Map())
  })

  it.each([
    [
      'a stage two automations both take',
      [PIPELINES, stage('dev-e2e-fix-start', { stage: 1 })],
      {
        'dev-e2e-fix': 'job 13: stage 1 is set by both dev-e2e-fix and dev-e2e-fix-start',
        'dev-e2e-fix-start': 'job 13: stage 1 is set by both dev-e2e-fix and dev-e2e-fix-start'
      }
    ],
    [
      'feeds naming no automation',
      [stage('dev-e2e-fix', { stage: 1, name: 'N', feeds: ['dev-e2e-fix-strat'] }), STARTS],
      { 'dev-e2e-fix': 'job.feeds: no automation "dev-e2e-fix-strat"' }
    ],
    [
      'feeds naming another job',
      [PIPELINES, stage('dev-e2e-fix-start', { stage: 2, id: '14', name: 'Other' })],
      {
        'dev-e2e-fix': 'job.feeds: dev-e2e-fix-start is in job 14, not job 13',
        'dev-e2e-fix-start': 'job.feeds: dev-e2e-fix feeds it from job 13; it is in job 14'
      }
    ],
    [
      'feeds naming an automation with no job',
      [PIPELINES, testDefinition({ id: 'dev-e2e-fix-start' })],
      { 'dev-e2e-fix': 'job.feeds: dev-e2e-fix-start is in no job, not job 13' }
    ],
    [
      'a cycle',
      [PIPELINES, stage('dev-e2e-fix-start', { stage: 2, feeds: ['dev-e2e-fix'] })],
      {
        'dev-e2e-fix':
          'job 13: feeds go round in a cycle: dev-e2e-fix → dev-e2e-fix-start → dev-e2e-fix',
        'dev-e2e-fix-start':
          'job 13: feeds go round in a cycle: dev-e2e-fix → dev-e2e-fix-start → dev-e2e-fix'
      }
    ],
    [
      'a stage that feeds itself',
      [stage('dev-e2e-fix', { stage: 1, name: 'N', feeds: ['dev-e2e-fix'] })],
      { 'dev-e2e-fix': 'job 13: feeds go round in a cycle: dev-e2e-fix → dev-e2e-fix' }
    ],
    [
      'no stage naming the job',
      [stage('dev-e2e-fix', { stage: 1, feeds: ['dev-e2e-fix-start'] }), STARTS],
      {
        'dev-e2e-fix': 'job 13: no stage sets job.name',
        'dev-e2e-fix-start': 'job 13: no stage sets job.name'
      }
    ],
    [
      'two stages naming it differently',
      [PIPELINES, stage('dev-e2e-fix-start', { stage: 2, name: 'Fix e2e' })],
      {
        'dev-e2e-fix':
          'job 13: its stages name it differently ("Fix red hourly e2e on dev", "Fix e2e")',
        'dev-e2e-fix-start':
          'job 13: its stages name it differently ("Fix red hourly e2e on dev", "Fix e2e")'
      }
    ]
  ])('refuses %s, on every definition involved', (_name, defs, problems) => {
    const found = jobProblems(defs)
    expect(Object.fromEntries([...found].map(([id, list]) => [id, list.join('\n')]))).toEqual(
      problems
    )
  })

  it('accepts the same name set on two stages', () => {
    expect(
      jobProblems([
        PIPELINES,
        stage('dev-e2e-fix-start', { stage: 2, name: 'Fix red hourly e2e on dev' })
      ])
    ).toEqual(new Map())
  })
})
