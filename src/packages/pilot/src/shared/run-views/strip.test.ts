import { describe, expect, it } from 'vitest'
import { testDefinition, testStep } from '../definition/__fixtures__/definition'
import { stepAt, testCard, testRun, testStepRow } from './__fixtures__/runs'
import { chainOf } from './chain'
import { paintRun } from './paint'
import { foldStrip, liveStrip, runStrip, stripOf, type StripChip, type StripItem } from './strip'

const review = testDefinition({
  id: 'review',
  items: {
    kind: 'merge_request',
    where: {},
    match: [],
    customFields: [
      { name: 'head8', script: 'a', cache: 'per_head', timeoutMs: 1 },
      { name: 'card_context', script: 'b', cache: 'per_tick', timeoutMs: 1 }
    ]
  },
  checks: [{ kind: 'worktree_exists' }],
  start: 'ask_first',
  askFirst: { title: 'Prepare?', context: '', options: [] },
  steps: [testStep({ name: 'prepare', skill: 'review-mr' })],
  answers: { resume: 'asking_session', else: null }
})
const chain = chainOf(review, [review])

function chips(n: number, lit: number[] = []): StripChip[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `c${i}`,
    label: `c${i}`,
    who: 'agent' as const,
    state: lit.includes(i) ? ('running' as const) : ('done' as const),
    runIds: [],
    part: `c${i}`,
    n: null
  }))
}
const keptKeys = (items: StripItem[]): string[] =>
  items.map((i) => {
    if (i.kind === 'more') {
      return `+${i.count}`
    }
    if (i.kind === 'note') {
      return i.text
    }
    return i.chip.key
  })

describe('stripOf', () => {
  it('folds the parts before any step into one chip and numbers each step by its name', () => {
    expect(stripOf(chain).map((c) => [c.key, c.n, c.label, c.who, c.state])).toEqual([
      ['pre', null, 'MRs · 1 gate', 'pilot', null],
      ['fields', null, '2 field scripts', 'script', null],
      ['ask', null, 'asks you', 'you', null],
      ['step:0', 1, 'prepare', 'agent', null]
    ])
  })

  it("gives each chip its run's state, the most pressing of its parts", () => {
    const run = testRun({ automationId: 'review', trigger: 'ask_first', status: 'asking' })
    expect(stripOf(paintRun(chain, { run }).parts).map((c) => [c.key, c.state])).toEqual([
      ['pre', 'done'],
      ['fields', 'done'],
      ['ask', 'asking'],
      ['step:0', 'not_reached']
    ])
  })

  it("opens a chip at the part that's pressing, not the first", () => {
    const run = testRun({
      automationId: 'review',
      status: 'failed',
      outcome: "Couldn't start",
      finishedAt: 2
    })
    const pre = stripOf(paintRun(chain, { run }).parts).find((c) => c.key === 'pre')
    expect(pre).toMatchObject({ state: 'failed', part: 'workspace' })
    expect(stripOf(chain).find((c) => c.key === 'pre')?.part).toBe('starts')
  })
})

describe('liveStrip', () => {
  it('lights the chip each live run is on, with every run on it', () => {
    const live = [
      testRun({
        id: 'a',
        automationId: 'review',
        trigger: 'ask_first',
        steps: [stepAt(0, 'prepare', 'running')]
      }),
      testRun({
        id: 'b',
        automationId: 'review',
        trigger: 'ask_first',
        steps: [stepAt(0, 'prepare', 'running')]
      }),
      testRun({ id: 'c', automationId: 'review', trigger: 'ask_first', status: 'asking' })
    ]
    const lit = liveStrip(chain, live)
    expect(lit.find((c) => c.key === 'step:0')).toMatchObject({
      state: 'running',
      runIds: ['a', 'b']
    })
    expect(lit.find((c) => c.key === 'ask')).toMatchObject({ state: 'asking', runIds: ['c'] })
    expect(lit.find((c) => c.key === 'pre')).toMatchObject({ state: null, runIds: [] })
  })

  it.each([
    [
      'older than a YAML change',
      testRun({
        id: 'old',
        automationId: 'review',
        trigger: 'ask_first',
        steps: [stepAt(0, 'renamed_step', 'running')]
      })
    ],
    [
      'imported from the vault',
      testRun({
        id: 'imp',
        automationId: 'review',
        tickId: null,
        trigger: 'import',
        status: 'needs_you',
        steps: [stepAt(0, 'imported', 'done')],
        inbox: [testCard({ runId: 'imp', stepIdx: 0, type: 'left_for_you' })]
      })
    ]
  ])('lights no step chip for a live run %s', (_, run) => {
    const lit = liveStrip(chain, [run])
    expect(lit.find((c) => c.key === 'step:0')).toMatchObject({ state: null, runIds: [] })
  })

  it('lights the step whose open card a finished run waits on', () => {
    const waiting = testRun({
      id: 'w',
      automationId: 'review',
      status: 'needs_you',
      steps: [stepAt(0, 'prepare', 'done')],
      inbox: [testCard({ runId: 'w', stepIdx: 0, type: 'left_for_you' })]
    })
    expect(liveStrip(chain, [waiting]).find((c) => c.key === 'step:0')).toMatchObject({
      state: 'asking',
      runIds: ['w']
    })
  })

  it('adds an answers chip while an answer run is live, and never lights a step for it', () => {
    const answering = testRun({
      id: 'r2',
      tickId: null,
      trigger: 'answer',
      parentRunId: 'r1',
      steps: [stepAt(0, 'answers', 'running')]
    })
    const lit = liveStrip(chain, [answering])
    expect(lit.find((c) => c.key === 'step:0')?.runIds).toEqual([])
    expect(lit.find((c) => c.key === 'answers')).toMatchObject({ state: 'running', runIds: ['r2'] })
    expect(lit.some((c) => c.key.startsWith('answer:'))).toBe(false)
  })
})

describe('foldStrip', () => {
  it.each<[string, StripChip[], string[], string | null]>([
    ['a short strip whole', chips(4), ['c0', 'c1', 'c2', 'c3'], null],
    [
      'a long one around its running chip',
      chips(11, [6]),
      ['c0', '+4', 'c5', 'c6', 'c7', '+3'],
      null
    ],
    [
      'a long one with nothing lit from its start',
      chips(11),
      ['c0', 'c1', 'c2', 'c3', 'c4', '+6'],
      null
    ],
    [
      'every lit chip of a long one',
      chips(11, [2, 9]),
      ['c0', 'c1', 'c2', 'c3', '+4', 'c8', 'c9', 'c10'],
      null
    ],
    [
      'the chip it is told to keep, with its neighbours',
      chips(11),
      ['c0', '+7', 'c8', 'c9', 'c10'],
      'c9'
    ]
  ])('keeps %s', (_name, input, expected, keep) => {
    const folded = foldStrip(input, undefined, keep)
    expect(keptKeys(folded)).toEqual(expected)
    const hidden = folded.reduce((n, i) => n + (i.kind === 'more' ? i.count : 1), 0)
    expect(hidden).toBe(input.length)
  })
})

// Job 03's shape: one of each round's two steps is skipped by its when.
const rounds = testDefinition({
  id: 'rounds',
  steps: ['begin', 'r1_claude', 'r1_codex', 'r2_codex', 'r2_claude', 'publish'].map((name) =>
    testStep({ name, skill: 'review' })
  )
})
const roundsChain = chainOf(rounds, [rounds])
const WHEN = 'when: x is false'

function describeItem(item: StripItem): string {
  if (item.kind === 'note') {
    return item.text
  }
  if (item.kind === 'more') {
    return `+${item.count}`
  }
  const { chip } = item
  if (chip.n === null) {
    return `${chip.key} ${chip.state}`
  }
  return `${chip.n} ${chip.label} ${chip.state}`
}

describe('runStrip', () => {
  it.each<[string, Parameters<typeof testRun>[0], string[]]>([
    [
      'only the steps that ran, numbered in order, and how many did not',
      {
        status: 'failed',
        finishedAt: 9,
        steps: [
          testStepRow({ idx: 0, name: 'begin', status: 'done', startedAt: 1 }),
          testStepRow({ idx: 1, name: 'r1_claude', status: 'skipped', error: WHEN }),
          testStepRow({ idx: 2, name: 'r1_codex', status: 'done', startedAt: 2 }),
          testStepRow({ idx: 3, name: 'r2_codex', status: 'skipped', error: WHEN }),
          testStepRow({ idx: 4, name: 'r2_claude', status: 'failed', startedAt: 3 }),
          testStepRow({
            idx: 5,
            name: 'publish',
            status: 'skipped',
            error: 'Step r2_claude failed'
          })
        ]
      },
      ['1 begin done', '2 r1_codex done', '3 r2_claude failed', "3 didn't run"]
    ],
    [
      'a live run with what is still to go',
      {
        status: 'running',
        steps: [
          testStepRow({ idx: 0, name: 'begin', status: 'done', startedAt: 1 }),
          testStepRow({ idx: 1, name: 'r1_claude', status: 'running', startedAt: 2 })
        ]
      },
      ['1 begin done', '2 r1_claude running', '4 to go']
    ],
    [
      'the parts before any step, when they are where the run stopped',
      { status: 'failed', finishedAt: 9, outcome: "Couldn't start" },
      ['pre failed', '6 not reached']
    ]
  ])('shows %s', (_name, over, expected) => {
    const run = testRun({ automationId: 'rounds', ...over })
    const items = runStrip(paintRun(roundsChain, { run }).parts, run)
    expect(items.map(describeItem)).toEqual(expected)
  })
})
