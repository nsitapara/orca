import { describe, expect, it } from 'vitest'
import { testDefinition, testStep } from '../definition/__fixtures__/definition'
import { stepAt, testCard, testHandover, testRun } from './__fixtures__/runs'
import { chainOf, type ChainPart } from './chain'
import { paintRun, type PaintedPart, type PaintInput, type PartState } from './paint'

const shell = (name: string, run: string, over = {}) =>
  testStep({ name, agent: 'shell', run, prompt: null, ...over })
const def = testDefinition({
  id: 'job',
  items: {
    kind: 'merge_request',
    where: {},
    match: [],
    customFields: [{ name: 'head8', script: 'f.py', cache: 'per_tick', timeoutMs: 1 }]
  },
  checks: [
    { kind: 'quota', agent: 'claude', weekly: 90, session: 95 },
    { kind: 'script', run: 'c.py', timeoutMs: 1 }
  ],
  steps: [
    shell('context', 'ctx.py'),
    testStep({ name: 'fix', skill: 'fix' }),
    shell('cleanup', 'clean.sh', { always: true }),
    shell('merge_back', 'mb.sh', { when: 'x' })
  ],
  answers: { resume: 'asking_session', else: null },
  job: {
    id: 'j',
    name: 'J',
    stage: 1,
    label: 'One',
    feeds: [
      {
        to: 'next',
        pass: { id: 'ticket' },
        run: 'now',
        when: 'success',
        caption: null,
        trust: 'shell'
      }
    ]
  }
})
const next = testDefinition({
  id: 'next',
  job: { id: 'j', name: null, stage: 2, label: 'Two', feeds: [] }
})
const chain = chainOf(def, [def, next])
const askDef = testDefinition({
  id: 'ask',
  start: 'ask_first',
  askFirst: { title: 'Go?', context: '', options: [] }
})
const askChain = chainOf(askDef, [askDef])
const allSteps = [
  stepAt(0, 'context', 'done'),
  stepAt(1, 'fix', 'done'),
  stepAt(2, 'cleanup', 'done'),
  stepAt(3, 'merge_back', 'skipped')
]

const states = (parts: PaintedPart[]): Record<string, PartState> =>
  Object.fromEntries(parts.map((p) => [p.key, p.state]))
const byKey = (parts: PaintedPart[]): Record<string, PaintedPart> =>
  Object.fromEntries(parts.map((p) => [p.key, p]))

describe('paintRun', () => {
  it.each<[string, ChainPart[], PaintInput, Record<string, PartState>]>([
    [
      'running at its second step',
      chain,
      { run: testRun({ steps: [stepAt(0, 'context', 'done'), stepAt(1, 'fix', 'running')] }) },
      {
        starts: 'done',
        picks: 'done',
        'field:head8': 'done',
        gates: 'done',
        'check:1': 'done',
        workspace: 'done',
        'step:0': 'done',
        'step:1': 'running',
        'step:2': 'not_reached',
        'step:3': 'not_reached',
        answers: 'none',
        'handover:next': 'not_reached'
      }
    ],
    [
      'an agent step that left an open question: it keeps its own state',
      chain,
      {
        run: testRun({
          status: 'needs_you',
          finishedAt: 5,
          steps: allSteps,
          inbox: [testCard({ stepIdx: 1 })]
        })
      },
      {
        'step:1': 'done',
        'step:2': 'done',
        'step:3': 'skipped',
        answers: 'none',
        'handover:next': 'none'
      }
    ],
    [
      'a step that took a default',
      chain,
      {
        run: testRun({
          status: 'done',
          finishedAt: 5,
          steps: allSteps,
          inbox: [testCard({ stepIdx: 1, type: 'default' })]
        })
      },
      { 'step:1': 'done', answers: 'none' }
    ],
    [
      'failed, with its always cleanup run',
      chain,
      {
        run: testRun({
          status: 'failed',
          finishedAt: 5,
          steps: [
            stepAt(0, 'context', 'done'),
            stepAt(1, 'fix', 'failed'),
            stepAt(2, 'cleanup', 'done')
          ]
        })
      },
      { 'step:1': 'failed', 'step:2': 'done', 'step:3': 'not_reached' }
    ],
    [
      'stopped at its context step',
      chain,
      {
        run: testRun({
          status: 'done',
          finishedAt: 5,
          steps: [stepAt(0, 'context', 'stopped'), stepAt(2, 'cleanup', 'done')]
        })
      },
      { 'step:0': 'done', 'step:1': 'not_reached', 'step:2': 'done' }
    ],
    [
      'asking first',
      askChain,
      {
        run: testRun({
          automationId: 'ask',
          status: 'asking',
          trigger: 'ask_first',
          inbox: [testCard({ stepIdx: null })]
        })
      },
      { ask: 'asking', workspace: 'not_reached', 'step:0': 'not_reached' }
    ],
    [
      'skipped when it asked first',
      askChain,
      {
        run: testRun({
          automationId: 'ask',
          status: 'cancelled',
          trigger: 'ask_first',
          outcome: 'Not started: Skip',
          finishedAt: 5
        })
      },
      { ask: 'skipped', workspace: 'not_reached', 'step:0': 'not_reached' }
    ],
    [
      'approved after asking first',
      askChain,
      {
        run: testRun({
          automationId: 'ask',
          trigger: 'ask_first',
          steps: [stepAt(0, 'step1', 'running')]
        })
      },
      { ask: 'done', workspace: 'done', 'step:0': 'running' }
    ],
    [
      'that never launched',
      chain,
      {
        run: testRun({ status: 'failed', outcome: "Couldn't start: no such repo", finishedAt: 2 })
      },
      { workspace: 'failed', 'step:0': 'not_reached' }
    ],
    [
      'whose tick was pruned',
      chain,
      { run: testRun({ steps: [stepAt(0, 'context', 'running')] }), tickItem: null },
      { starts: 'done', 'field:head8': 'done', gates: 'done', 'check:1': 'done' }
    ],
    [
      'answered, with its answer run going',
      chain,
      {
        run: testRun({
          status: 'done',
          finishedAt: 5,
          steps: allSteps,
          inbox: [testCard({ stepIdx: 1, status: 'answered' })]
        }),
        answerRuns: [testRun({ id: 'r2', tickId: null, trigger: 'answer', parentRunId: 'r1' })]
      },
      { 'step:1': 'done', answers: 'running' }
    ],
    [
      'that handed over',
      chain,
      {
        run: testRun({ status: 'done', finishedAt: 5, steps: allSteps }),
        handovers: [testHandover()]
      },
      { 'handover:next': 'done' }
    ]
  ])('paints a run %s', (_name, parts, input, expected) => {
    expect(states(paintRun(parts, input).parts)).toMatchObject(expected)
  })

  it('shows field values, check reasons and what started it, and links what asked and what it started', () => {
    const painted = paintRun(chain, {
      run: testRun({
        status: 'needs_you',
        steps: allSteps,
        inbox: [
          testCard({ id: 'c1', stepIdx: 1 }),
          testCard({ id: 'c2', stepIdx: 1, type: 'default' }),
          testCard({ id: 'c3', stepIdx: 2, status: 'answered' })
        ]
      }),
      tickItem: {
        tickId: 7,
        itemKey: '!1',
        label: '!1',
        verdict: 'started',
        reason: '',
        checks: [
          { check: 'Quota', ok: true, reason: '41% week' },
          { check: 'Check c.py', ok: false, reason: 'busy' }
        ],
        fields: { 'mr.head8': '1c9e04aa' },
        runId: 'r1'
      },
      trigger: { automationId: 'one', runId: 'r0', stage: 1, ids: ['WEB-1'] },
      handovers: [testHandover({ itemId: 'WEB-2', verdict: 'started', runId: 'r9' })]
    })
    const by = byKey(painted.parts)
    expect(by['field:head8'].detail).toBe('head8 = 1c9e04aa')
    expect(by.gates).toMatchObject({ state: 'done', detail: '41% week' })
    expect(by['check:1']).toMatchObject({ state: 'failed', detail: 'busy' })
    expect(by.starts.detail).toBe('Handed over by stage 1: WEB-1')
    expect(by['step:1'].card?.id).toBe('c1')
    expect(by['step:1'].cards.map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(by['step:2'].cards.map((c) => c.id)).toEqual(['c3'])
    expect(by['handover:next']).toMatchObject({ detail: 'WEB-2 → started', linkRunId: 'r9' })
  })

  it('shows only the stored steps of a run older than a YAML change', () => {
    const painted = paintRun(chain, {
      run: testRun({
        status: 'done',
        finishedAt: 5,
        steps: [stepAt(0, 'context', 'done'), stepAt(1, 'old_fix', 'done')]
      })
    })
    expect(painted.drifted).toBe(true)
    expect(painted.parts.filter((p) => p.kind === 'step').map((p) => [p.name, p.state])).toEqual([
      ['context', 'done'],
      ['old_fix', 'done']
    ])
  })

  it('paints an answer run as its own steps under Answers, linking the run it answers', () => {
    const painted = paintRun(chain, {
      run: testRun({
        id: 'r2',
        tickId: null,
        trigger: 'answer',
        parentRunId: 'r1',
        steps: [stepAt(0, 'answers', 'running')]
      })
    })
    expect(states(painted.parts)).toMatchObject({
      starts: 'none',
      picks: 'none',
      workspace: 'none',
      'answer:0': 'running',
      answers: 'running',
      'handover:next': 'none'
    })
    expect(painted.parts.some((p) => p.key === 'step:0')).toBe(false)
    expect(byKey(painted.parts).answers.linkRunId).toBe('r1')
  })

  it('paints an import run from its stored steps without saying the YAML changed', () => {
    const painted = paintRun(chain, {
      run: testRun({
        trigger: 'import',
        tickId: null,
        status: 'done',
        steps: [stepAt(0, 'imported', 'done')]
      })
    })
    expect(painted.drifted).toBe(false)
    expect(painted.parts.filter((p) => p.kind === 'step').map((p) => [p.name, p.state])).toEqual([
      ['imported', 'done']
    ])
    expect(painted.parts.some((p) => p.key === 'step:1')).toBe(false)
  })

  it.each([
    ['a short value', '1c9e04aa', 'head8 = 1c9e04aa'],
    ['a long value', 'MR title that is a whole sentence', null],
    ['a multi-line value', 'one\ntwo', null]
  ])("shows a field row's value only when it is short and on one line: %s", (_n, value, detail) => {
    const painted = paintRun(chain, {
      run: testRun(),
      tickItem: {
        tickId: 7,
        itemKey: '!1',
        label: '!1',
        verdict: 'started',
        reason: '',
        checks: [],
        fields: { 'mr.head8': value },
        runId: 'r1'
      }
    })
    expect(byKey(painted.parts)['field:head8']).toMatchObject({ state: 'done', detail })
  })

  it('links the Starts row to the run that handed the work over', () => {
    const painted = paintRun(chain, {
      run: testRun(),
      trigger: { automationId: 'one', runId: 'r0', stage: 1, ids: ['WEB-1'] },
      receivedFrom: [testHandover({ senderRunId: 'r0' })]
    })
    expect(byKey(painted.parts).starts.linkRunId).toBe('r0')
    expect(byKey(paintRun(chain, { run: testRun() }).parts).starts.linkRunId).toBeNull()
  })
})
