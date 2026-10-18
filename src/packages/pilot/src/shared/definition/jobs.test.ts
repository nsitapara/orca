import { describe, expect, it } from 'vitest'
import { testDefinition, testStep } from './__fixtures__/definition'
import { jobProblems, jobWarnings } from './jobs'
import { parseAutomationYaml } from './parse'
import type { AutomationDefinition, FeedDef, JobDef } from './types'

const BASE = 'name: n\nrepo: r\nschedule: manual\nsteps:\n  - { agent: claude, prompt: x }\n'
const SHELL_BASE =
  'name: n\nrepo: r\nschedule: manual\nsteps:\n  - { name: ticket, agent: shell, run: ./t.sh, outputs: [ticket] }\n'

function parsed(job: string, base = BASE) {
  return parseAutomationYaml(`${base}job:\n${job}`, '/a/n.yaml')
}
function errorsOf(job: string, base = BASE): string {
  const result = parsed(job, base)
  return result.ok ? '' : result.errors.map((e) => e.replace('/a/n.yaml: ', '')).join('\n')
}

describe('the job: block', () => {
  it('reads the old shape, a name or a list of names, as arrows only, captioned with hands_over', () => {
    const result = parsed(
      '  id: "13"\n  name: Fix red hourly e2e on dev\n  stage: 1\n  label: Open or update the ticket\n  feeds: dev-e2e-fix-start\n  hands_over: the tickets it opens\n'
    )
    expect(result.ok && result.definition.job).toEqual({
      id: '13',
      name: 'Fix red hourly e2e on dev',
      stage: 1,
      label: 'Open or update the ticket',
      feeds: [
        {
          to: 'dev-e2e-fix-start',
          pass: null,
          run: 'next_schedule',
          when: 'success',
          caption: 'the tickets it opens',
          trust: 'shell'
        }
      ]
    })
    const second = parsed('  id: "13"\n  stage: 2\n  label: Start a fix session per ticket\n')
    expect(second.ok && second.definition.job).toEqual({
      id: '13',
      name: null,
      stage: 2,
      label: 'Start a fix session per ticket',
      feeds: []
    })
  })

  it('reads feeds as connections: to, pass (an output → the item ids), run, when and caption', () => {
    const result = parsed(
      '  id: "13"\n  name: N\n  stage: 1\n  label: L\n  feeds:\n    - to: dev-e2e-fix-start\n      pass: { id: ticket }\n      run: now\n      when: always\n      caption: the tickets it opens\n    - to: other\n',
      SHELL_BASE
    )
    expect(result.ok && result.definition.job?.feeds).toEqual([
      {
        to: 'dev-e2e-fix-start',
        pass: { id: 'ticket' },
        run: 'now',
        when: 'always',
        caption: 'the tickets it opens',
        trust: 'shell'
      },
      {
        to: 'other',
        pass: null,
        run: 'next_schedule',
        when: 'success',
        caption: null,
        trust: 'shell'
      }
    ])
    expect(result.ok && result.definition.steps[0].outputs).toEqual(['ticket'])
  })

  it('passes an agent step’s output on only with trust: agent', () => {
    const agentBase =
      'name: n\nrepo: r\nschedule: manual\nsteps:\n  - { name: review, agent: claude, prompt: x, outputs: [ticket] }\n'
    const job = (trust: string) =>
      `  id: "13"\n  stage: 1\n  label: x\n  feeds: [{ to: b, pass: { id: ticket }${trust} }]\n`
    expect(errorsOf(job(''), agentBase)).toContain(
      'job.feeds[0].pass.id: "ticket" is declared by agent step 1 (review); pass an agent\'s output on only with trust: agent'
    )
    const trusted = parsed(job(', trust: agent'), agentBase)
    expect(trusted.ok && trusted.definition.job?.feeds[0].trust).toBe('agent')
    const shell = parsed(job(''), SHELL_BASE)
    expect(shell.ok && shell.definition.job?.feeds[0].trust).toBe('shell')
  })

  it('leaves an automation without the block a job of its own, and a step without outputs: declaring none', () => {
    const result = parseAutomationYaml(BASE, '/a/n.yaml')
    expect(result.ok && result.definition.job).toBeNull()
    expect(result.ok && result.definition.steps[0].outputs).toEqual([])
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
    ],
    [
      'hands_over beside connections only',
      '  id: "13"\n  stage: 1\n  label: x\n  feeds: [{ to: b }]\n  hands_over: tickets\n',
      'job.hands_over: it captions only feeds given by name; give each connection its own caption:'
    ],
    [
      'a connection without to',
      '  id: "13"\n  stage: 1\n  label: x\n  feeds: [{ run: now }]\n',
      'job.feeds.0'
    ],
    [
      'an unknown run',
      '  id: "13"\n  stage: 1\n  label: x\n  feeds: [{ to: b, run: later }]\n',
      'job.feeds.0.run'
    ],
    [
      'an unknown when',
      '  id: "13"\n  stage: 1\n  label: x\n  feeds: [{ to: b, when: failure }]\n',
      'job.feeds.0.when'
    ],
    [
      'an unknown pass key',
      '  id: "13"\n  stage: 1\n  label: x\n  feeds: [{ to: b, pass: { branch: ticket } }]\n',
      'job.feeds.0.pass.id: expected the output to hand over as item ids, like pass: { id: ticket }'
    ],
    [
      'the same stage fed twice',
      '  id: "13"\n  stage: 1\n  label: x\n  feeds: [b, { to: b, run: now }]\n',
      'job.feeds: b is listed more than once'
    ],
    [
      'a pass of an output no step declares',
      '  id: "13"\n  stage: 1\n  label: x\n  feeds: [{ to: b, pass: { id: ticket } }]\n',
      'job.feeds[0].pass.id: no step declares the output "ticket"; add outputs: [ticket] to the step that writes it'
    ]
  ])('refuses %s', (_name, job, error) => {
    expect(errorsOf(job)).toContain(error)
  })

  it.each([
    ['an output name that is not a key', '[ticket.id]', 'steps.0.outputs.0'],
    ['an output declared twice', '[ticket, ticket]', 'step 1: outputs: "ticket" is listed twice']
  ])('refuses a step with %s', (_name, outputs, error) => {
    const yaml = `name: n\nrepo: r\nschedule: manual\nsteps:\n  - { agent: shell, run: ./t.sh, outputs: ${outputs} }\n`
    const result = parseAutomationYaml(yaml, '/a/n.yaml')
    expect(result.ok ? '' : result.errors.join('\n')).toContain(error)
  })
})

function stage(id: string, job: Partial<JobDef> & { stage: number }): AutomationDefinition {
  return testDefinition({
    id,
    file: `/autos/${id}.yaml`,
    job: { id: '13', name: null, label: `${id} label`, feeds: [], ...job }
  })
}
// A connection as the old shape (a name) reads: an arrow only.
function arrow(to: string, caption: string | null = null): FeedDef {
  return { to, pass: null, run: 'next_schedule', when: 'success', caption, trust: 'shell' }
}
// A connection that hands the ticket output on and ticks the receiver at once.
function handover(to: string): FeedDef {
  return { to, pass: { id: 'ticket' }, run: 'now', when: 'success', caption: null, trust: 'shell' }
}
const PIPELINES = stage('dev-e2e-fix', {
  stage: 1,
  name: 'Fix red hourly e2e on dev',
  feeds: [arrow('dev-e2e-fix-start', 'the tickets it opens')]
})
const STARTS = stage('dev-e2e-fix-start', { stage: 2 })
// 13 after it adopts the handover: stage 1's ticket step declares `ticket`, stage 2 reads what it is fed.
const HANDING: AutomationDefinition = {
  ...stage('dev-e2e-fix', {
    stage: 1,
    name: 'Fix red hourly e2e on dev',
    feeds: [handover('dev-e2e-fix-start')]
  }),
  steps: [testStep({ name: 'ticket', agent: 'shell', run: './t.sh', outputs: ['ticket'] })]
}
function withFeeds(def: AutomationDefinition, feeds: FeedDef[]): AutomationDefinition {
  return { ...def, job: def.job && { ...def.job, feeds } }
}
function fed(over: Partial<AutomationDefinition> = {}): AutomationDefinition {
  return {
    ...STARTS,
    items: {
      kind: 'linear_ticket',
      where: { ids_from: { feed: true, run: 'list-ids', field: 'identifier' } },
      match: [],
      customFields: []
    },
    ...over
  }
}

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
      'a cycle',
      [PIPELINES, stage('dev-e2e-fix-start', { stage: 2, feeds: [arrow('dev-e2e-fix')] })],
      {
        'dev-e2e-fix':
          'job 13: feeds go round in a cycle: dev-e2e-fix → dev-e2e-fix-start → dev-e2e-fix',
        'dev-e2e-fix-start':
          'job 13: feeds go round in a cycle: dev-e2e-fix → dev-e2e-fix-start → dev-e2e-fix'
      }
    ],
    [
      'a stage that feeds itself',
      [stage('dev-e2e-fix', { stage: 1, name: 'N', feeds: [arrow('dev-e2e-fix')] })],
      { 'dev-e2e-fix': 'job 13: feeds go round in a cycle: dev-e2e-fix → dev-e2e-fix' }
    ],
    [
      'no stage naming the job',
      [stage('dev-e2e-fix', { stage: 1, feeds: [arrow('dev-e2e-fix-start')] }), STARTS],
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
    ],
    [
      'a handover from a pinned stage to an unpinned one',
      [{ ...HANDING, runsOn: 'Mac mini' }, fed()],
      {
        'dev-e2e-fix':
          'job.feeds: dev-e2e-fix runs on Mac mini and dev-e2e-fix-start has no runs_on; a feed that passes ids or runs now must stay on one machine, since a handover stays in the database of the machine whose run wrote it'
      }
    ],
    [
      'a handover to a stage pinned when the sender is not',
      [HANDING, fed({ runsOn: 'Mac mini' })],
      {
        'dev-e2e-fix':
          'job.feeds: dev-e2e-fix-start runs on Mac mini and dev-e2e-fix has no runs_on; a feed that passes ids or runs now must stay on one machine, since a handover stays in the database of the machine whose run wrote it'
      }
    ],
    [
      'a handover between stages pinned to different machines',
      [{ ...HANDING, runsOn: 'Studio' }, fed({ runsOn: 'Mac mini' })],
      {
        'dev-e2e-fix':
          'job.feeds: dev-e2e-fix runs on Studio and dev-e2e-fix-start runs on Mac mini; a feed that passes ids or runs now must stay on one machine, since a handover stays in the database of the machine whose run wrote it'
      }
    ]
  ])('refuses %s, on every definition involved', (_name, defs, problems) => {
    const found = jobProblems(defs)
    expect(Object.fromEntries([...found].map(([id, list]) => [id, list.join('\n')]))).toEqual(
      problems
    )
  })

  it('accepts stages pinned to the same machine, whatever the case', () => {
    expect(jobProblems([{ ...HANDING, runsOn: 'mac mini' }, fed({ runsOn: 'Mac Mini' })])).toEqual(
      new Map()
    )
  })

  it('accepts a stage that hands ids to a stage that reads what it is fed', () => {
    expect(jobProblems([HANDING, fed()])).toEqual(new Map())
    expect(jobWarnings([HANDING, fed()])).toEqual(new Map())
  })

  it.each([
    [
      'a handover to no automation',
      [withFeeds(HANDING, [handover('dev-e2e-fix-strat')]), fed()],
      {
        'dev-e2e-fix':
          'job.feeds: no automation "dev-e2e-fix-strat"; a feed that passes ids or runs now must name a stage of job 13',
        'dev-e2e-fix-start':
          'items.where.ids_from.feed: no stage of job 13 passes ids to dev-e2e-fix-start (a job.feeds connection with to: dev-e2e-fix-start and pass:)'
      }
    ],
    [
      'a handover to a stage of another job',
      [HANDING, fed({ job: { id: '14', name: 'Other', stage: 1, label: 'l', feeds: [] } })],
      {
        'dev-e2e-fix':
          'job.feeds: dev-e2e-fix-start is in job 14, not job 13; a feed that passes ids or runs now must name a stage of job 13',
        'dev-e2e-fix-start':
          'items.where.ids_from.feed: no stage of job 14 passes ids to dev-e2e-fix-start (a job.feeds connection with to: dev-e2e-fix-start and pass:)'
      }
    ],
    [
      'a run: now feed to an automation with no job',
      [
        withFeeds(PIPELINES, [{ ...arrow('dev-e2e-fix-start'), run: 'now' }]),
        testDefinition({ id: 'dev-e2e-fix-start' })
      ],
      {
        'dev-e2e-fix':
          'job.feeds: dev-e2e-fix-start is in no job; a feed that passes ids or runs now must name a stage of job 13'
      }
    ],
    [
      'ids passed to a stage that never reads them',
      [HANDING, STARTS],
      {
        'dev-e2e-fix':
          'job.feeds: dev-e2e-fix-start never reads the ids it is passed; give it items.where.ids_from: { feed: true }'
      }
    ],
    [
      'a stage that reads what it is fed, with no stage feeding it ids',
      [PIPELINES, fed()],
      {
        'dev-e2e-fix-start':
          'items.where.ids_from.feed: no stage of job 13 passes ids to dev-e2e-fix-start (a job.feeds connection with to: dev-e2e-fix-start and pass:)'
      }
    ]
  ])('refuses %s', (_name, defs, problems) => {
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

describe('jobWarnings: a feeds arrow that cannot be drawn warns, and never freezes a stage', () => {
  it.each([
    [
      'feeds naming no automation (a renamed target)',
      [stage('dev-e2e-fix', { stage: 1, name: 'N', feeds: [arrow('dev-e2e-fix-strat')] }), STARTS],
      { 'dev-e2e-fix': `job.feeds: no automation "dev-e2e-fix-strat"; its arrow isn't drawn` }
    ],
    [
      'feeds naming another job',
      [PIPELINES, stage('dev-e2e-fix-start', { stage: 1, id: '14', name: 'Other' })],
      {
        'dev-e2e-fix': `job.feeds: dev-e2e-fix-start is in job 14, not job 13; its arrow isn't drawn`
      }
    ],
    [
      'feeds naming an automation with no job',
      [PIPELINES, testDefinition({ id: 'dev-e2e-fix-start' })],
      { 'dev-e2e-fix': `job.feeds: dev-e2e-fix-start is in no job; its arrow isn't drawn` }
    ]
  ])('%s', (_name, defs, warnings) => {
    expect(jobProblems(defs)).toEqual(new Map())
    const found = jobWarnings(defs)
    expect(Object.fromEntries([...found].map(([id, list]) => [id, list.join('\n')]))).toEqual(
      warnings
    )
  })

  it('says nothing about feeds that reach a stage of the same job', () => {
    expect(jobWarnings([PIPELINES, STARTS])).toEqual(new Map())
  })
})
