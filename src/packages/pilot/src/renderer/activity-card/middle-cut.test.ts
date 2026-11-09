import { describe, expect, it } from 'vitest'
import { middleCutCandidates } from './middle-cut'

describe('middleCutCandidates', () => {
  it.each([
    {
      text: 'Fix hourly e2e failure on dev and 1 more',
      tail: 3,
      separator: ' ',
      first: 'Fix hourly e2e failure on … and 1 more',
      last: 'Fix … and 1 more'
    },
    {
      text: 'web-2642-fix-hourly-e2e-failure-on-dev-test-apps-e2e-staff',
      tail: 2,
      separator: '-',
      first: 'web-2642-fix-hourly-e2e-failure-on-dev-test-…-e2e-staff',
      last: 'web-…-e2e-staff'
    }
  ] as const)('$text keeps its last $tail parts', ({ text, tail, separator, first, last }) => {
    const candidates = middleCutCandidates(text, tail, separator)
    expect(candidates[0]).toBe(first)
    expect(candidates.at(-1)).toBe(last)
  })

  it('has nothing to drop when only the tail and one more part are there', () => {
    expect(middleCutCandidates('Allow reuse of email', 3, ' ')).toEqual([])
  })
})
