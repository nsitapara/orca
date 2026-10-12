import { describe, expect, it } from 'vitest'
import type { SpendPayload } from '../shared/api-types'
import { formatSpend, formatUsageReport } from './spend'

const base: SpendPayload = {
  by: 'automation',
  days: 7,
  sinceDay: '2026-10-05',
  rows: [],
  total: { costUsd: 0, tokens: 0, runs: 0 }
}

describe('formatSpend', () => {
  it('lists each group, cheapest last, then the total', () => {
    const p: SpendPayload = {
      ...base,
      rows: [
        {
          key: 'fix-ci',
          label: 'Fix failed CI',
          costUsd: 3,
          tokens: 350,
          runs: 2,
          steps: 3,
          unpricedBuckets: 1
        },
        {
          key: 'e2e',
          label: 'Fix red e2e',
          costUsd: 0.5,
          tokens: 1_200_000,
          runs: 1,
          steps: 1,
          unpricedBuckets: 0
        }
      ],
      total: { costUsd: 3.5, tokens: 1_200_350, runs: 3 }
    }
    expect(formatSpend(p).split('\n')).toEqual([
      'Spend since 2026-10-05 (last 7 days), by automation',
      '      $3.00     350 tokens    2 runs  Fix failed CI (some models have no price)',
      '      $0.50    1.2M tokens    1 run   Fix red e2e',
      '      $3.50    1.2M tokens    3 runs  total'
    ])
  })

  it('says when nothing was spent', () => {
    expect(formatSpend({ ...base, days: 1 })).toBe(
      'Spend since 2026-10-05 (last 1 day), by automation\n  Nothing spent in this window.'
    )
  })
})

describe('formatSpend total label', () => {
  const row = { key: 'k', label: 'K', costUsd: 1, tokens: 1, runs: 1, steps: 1, unpricedBuckets: 0 }
  it.each([
    ['automation', 'total'],
    ['mr', 'total'],
    ['skill', 'total (runs counted once)'],
    ['agent', 'total (runs counted once)']
  ] as const)('by %s ends in "%s"', (by, label) => {
    const lines = formatSpend({
      ...base,
      by,
      rows: [row],
      total: { costUsd: 1, tokens: 1, runs: 1 }
    }).split('\n')
    expect(lines.at(-1)).toMatch(new RegExp(`${label.replace(/[()]/g, '\\$&')}$`))
  })
})

describe('formatUsageReport', () => {
  it('says where it wrote and what is in it', () => {
    expect(
      formatUsageReport({
        dir: '/r',
        rows: 12,
        sessions: 5,
        costUsd: 3.5,
        files: ['/r/usage.json', '/r/usage.csv']
      })
    ).toBe('Wrote 2 files to /r: 5 sessions, 12 rows, $3.50')
  })
})
