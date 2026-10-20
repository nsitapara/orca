import { describe, expect, it } from 'vitest'
import { BucketSet, inWindow, localDay, totalsOf, type UsageBucket } from './buckets'

const at = (h: number, m = 0): number => new Date(2026, 9, 11, h, m).getTime()

describe('localDay', () => {
  it('is the local calendar day, like usage.py', () => {
    expect(localDay(new Date(2026, 9, 11, 23, 59).getTime())).toBe('2026-10-11')
    expect(localDay(new Date(2026, 9, 12, 0, 1).getTime())).toBe('2026-10-12')
  })
})

describe('inWindow', () => {
  it.each([
    ['before the step started', at(9, 59), null],
    ['inside the step', at(10, 30), at(10, 30)],
    ['at the moment it ended', at(11), at(11)],
    ['after it ended', at(11, 1), null]
  ])('%s', (_name, ms, expected) => {
    expect(inWindow(new Date(ms).toISOString(), { from: at(10), to: at(11) })).toBe(expected)
  })

  it('drops a timestamp it cannot read', () => {
    expect(inWindow('not a time', { from: 0, to: Number.MAX_SAFE_INTEGER })).toBeNull()
  })
})

describe('BucketSet', () => {
  it('adds rows by day and model; a bucket whose model has no price has no cost', () => {
    const set = new BucketSet('claude')
    const row = { requests: 1, input: 10, cacheRead: 5, cacheWrite: 2, output: 3, costUsd: 0.5 }
    set.add(at(10), 'claude-opus-5-5', row)
    set.add(at(10, 5), 'claude-opus-5-5', row)
    set.add(at(10), 'mystery', { ...row, costUsd: null })
    expect(set.list()).toEqual([
      {
        agent: 'claude',
        day: '2026-10-11',
        model: 'claude-opus-5-5',
        requests: 2,
        input: 20,
        cacheRead: 10,
        cacheWrite: 4,
        output: 6,
        costUsd: 1
      },
      {
        agent: 'claude',
        day: '2026-10-11',
        model: 'mystery',
        requests: 1,
        input: 10,
        cacheRead: 5,
        cacheWrite: 2,
        output: 3,
        costUsd: null
      }
    ])
  })
})

describe('totalsOf', () => {
  const b = (model: string, input: number, costUsd: number | null): UsageBucket => ({
    agent: 'claude',
    day: '2026-10-11',
    model,
    requests: 1,
    input,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    costUsd
  })

  it.each([
    [
      'priced and unpriced',
      [b('a', 10, 0.25), b('b', 30, null)],
      { costUsd: 0.25, tokens: 40, model: 'b' }
    ],
    ['only unpriced', [b('b', 30, null)], { costUsd: null, tokens: 30, model: 'b' }],
    ['nothing', [], { costUsd: null, tokens: 0, model: null }]
  ])('%s', (_name, buckets, expected) => {
    expect(totalsOf(buckets)).toEqual(expected)
  })
})
