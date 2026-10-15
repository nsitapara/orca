import { describe, expect, it } from 'vitest'
import { testDefinition, testStep } from '../definition/__fixtures__/definition'
import { stepAt, testRun } from './__fixtures__/runs'
import { chainOf } from './chain'
import { paintRun } from './paint'
import { foldStrip, liveStrip, stripOf, type StripChip, type StripItem } from './strip'

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
    part: `c${i}`
  }))
}
const keptKeys = (items: StripItem[]): string[] =>
  items.map((i) => (i.kind === 'more' ? `+${i.count}` : i.chip.key))

describe('stripOf', () => {
  it("folds the parts before any step into one chip and names each step's agent and skill", () => {
    expect(stripOf(chain).map((c) => [c.key, c.label, c.who, c.state])).toEqual([
      ['pre', 'MRs · 1 gate', 'pilot', null],
      ['fields', '2 field scripts', 'script', null],
      ['ask', 'asks you', 'you', null],
      ['step:0', 'Claude · review-mr', 'agent', null]
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
  it.each<[string, StripChip[], string[]]>([
    ['a short strip whole', chips(4), ['c0', 'c1', 'c2', 'c3']],
    ['a long one around its running chip', chips(11, [6]), ['c0', '+4', 'c5', 'c6', 'c7', '+3']],
    ['a long one with nothing lit from its start', chips(11), ['c0', 'c1', 'c2', 'c3', 'c4', '+6']],
    [
      'every lit chip of a long one',
      chips(11, [2, 9]),
      ['c0', 'c1', 'c2', 'c3', '+4', 'c8', 'c9', 'c10']
    ]
  ])('keeps %s', (_name, input, expected) => {
    const folded = foldStrip(input)
    expect(keptKeys(folded)).toEqual(expected)
    const hidden = folded.reduce((n, i) => n + (i.kind === 'more' ? i.count : 1), 0)
    expect(hidden).toBe(input.length)
  })
})
