import { describe, expect, it } from 'vitest'
import type { PilotStore } from '../store/store'
import { sinceDayFor, spendPayload } from './spend'

const OCT_11_NOON = new Date(2026, 9, 11, 12, 0).getTime()

describe('sinceDayFor', () => {
  it.each([
    [1, '2026-10-11'],
    [7, '2026-10-05'],
    [30, '2026-09-12']
  ])('%s day(s) back from Oct 11 → %s', (days, expected) => {
    expect(sinceDayFor(days, OCT_11_NOON)).toBe(expected)
  })
})

describe('spendPayload', () => {
  const raw = (key: string, itemLabel = '') => ({
    key,
    itemLabel,
    costUsd: 1,
    tokens: 10,
    runs: 1,
    steps: 1,
    unpricedBuckets: 0
  })
  const store = (rows: ReturnType<typeof raw>[]) =>
    ({
      spend: { byGroup: () => rows, totals: () => ({ costUsd: 1, tokens: 10, runs: 1 }) }
    }) as unknown as PilotStore

  it.each([
    ['automation', raw('fix-ci'), 'Fix failed CI'],
    ['automation', raw('gone'), 'gone'],
    ['skill', raw(''), '(no skill)'],
    ['skill', raw('fix-gitlab-ci'), 'fix-gitlab-ci'],
    ['agent', raw('codex'), 'codex'],
    ['mr', raw('mr:1561', '!1561 web-1493'), '!1561 web-1493']
  ] as const)('a %s row %o is labelled %s', (by, r, label) => {
    const p = spendPayload(store([r]), new Map([['fix-ci', 'Fix failed CI']]), by, 7, OCT_11_NOON)
    expect(p).toMatchObject({
      by,
      days: 7,
      sinceDay: '2026-10-05',
      total: { costUsd: 1, tokens: 10, runs: 1 }
    })
    expect(p.rows[0].label).toBe(label)
  })
})
