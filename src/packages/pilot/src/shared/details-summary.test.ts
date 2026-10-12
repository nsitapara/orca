import { describe, expect, it } from 'vitest'
import type { DetailsBlock, DetailsBundle } from './details'
import { summaryOf } from './details-summary'

function bundle(...blocks: DetailsBlock[]): DetailsBundle {
  return { version: 1, item: 'x', blocks }
}
const diff = (added: number, removed: number, patch?: string): DetailsBlock => ({
  type: 'diff',
  files: [{ path: 'a.ts', added, removed, hunks: [] }],
  patch
})
const facts = (...rows: [string, string][]): DetailsBlock => ({ type: 'facts', rows })
const pair = { before: 'b.png', after: 'a.png' }
const review = (n: number): [string, Record<string, string>] => [
  'r.json',
  { 'r.json': JSON.stringify({ parts: Array.from({ length: n }, (_, i) => ({ id: `p${i}` })) }) }
]

describe('summaryOf', () => {
  it('lists the chips in order, from the blocks', () => {
    const b = bundle(
      diff(3, 2, 'F2.patch'),
      diff(1, 0),
      { type: 'screens', pairs: [pair] },
      { type: 'shots', shots: [{ file: '1.png' }, { file: '2.png' }] },
      facts(['Severity', 'Major'], ['Status', 'Unconfirmed'])
    )
    expect(summaryOf(b, {}, true)).toEqual([
      'drafted fix',
      'diff +4 −2',
      'before / after',
      '2 screenshots'
    ])
  })

  it.each([
    ['one pair', bundle({ type: 'screens', pairs: [pair] }), ['before / after']],
    ['several pairs', bundle({ type: 'screens', pairs: [pair, pair, pair] }), ['3 before / after']],
    ['one shot', bundle({ type: 'shots', shots: [{ file: '1.png' }] }), ['1 screenshot']],
    [
      'severity and status',
      bundle(facts(['Severity', 'MINOR'], ['Status', 'unconfirmed'])),
      ['minor · unconfirmed']
    ],
    ['severity alone', bundle(facts(['Severity', 'minor'])), []],
    ['text only', bundle({ type: 'text', body: 'x' }), []]
  ])('%s', (_name, b, want) => {
    expect(summaryOf(b, {}, false)).toEqual(want)
  })

  it('counts a review block’s findings from its inlined text', () => {
    const [ref, texts] = review(4)
    expect(summaryOf(bundle({ type: 'review', file: ref }), texts, false)).toEqual(['4 findings'])
    const [one, oneText] = review(1)
    expect(summaryOf(bundle({ type: 'review', file: one }), oneText, false)).toEqual(['1 finding'])
    expect(summaryOf(bundle({ type: 'review', file: 'gone.json' }), {}, false)).toEqual([])
  })

  it('keeps at most 4 chips of at most 40 characters', () => {
    const [ref, texts] = review(2)
    const b = bundle(
      diff(1, 1, 'p'),
      { type: 'screens', pairs: [pair] },
      { type: 'shots', shots: [{ file: '1.png' }] },
      { type: 'review', file: ref },
      facts(['Severity', 'x'.repeat(60)], ['Status', 'open'])
    )
    const chips = summaryOf(b, texts, true)
    expect(chips).toHaveLength(4)
    const long = summaryOf(
      bundle(facts(['Severity', 'x'.repeat(60)], ['Status', 'open'])),
      {},
      false
    )
    expect(long[0].length).toBeLessThanOrEqual(40)
  })
})
