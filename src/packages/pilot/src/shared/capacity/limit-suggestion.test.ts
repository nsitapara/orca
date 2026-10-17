import { describe, expect, it } from 'vitest'
import { suggestRunLimit, UNMEASURED_JOB_BYTES } from './limit-suggestion'

const GIB = 1024 ** 3

describe('suggestRunLimit', () => {
  it.each([
    ['free memory less headroom, over the worst job', 12, 0, 2, 4],
    ['what running jobs hold as part of the budget', 6, 4, 2, 3],
    ['at least one when memory is short', 3, 0, 2, 1],
    ['at most the picker top', 200, 0, 1, 10],
    ['a floor under a job measured near empty', 6.5, 0, 0.001, 10]
  ])('counts %s', (_name, availableGib, runningGib, worstGib, expected) => {
    const suggestion = suggestRunLimit({
      availableBytes: availableGib * GIB,
      runningJobsBytes: runningGib * GIB,
      worstJobBytes: worstGib * GIB
    })
    expect(suggestion.limit).toBe(expected)
  })

  it('budgets an unmeasured job like a stack, and says it is unmeasured', () => {
    const suggestion = suggestRunLimit({
      availableBytes: 14 * GIB,
      runningJobsBytes: 0,
      worstJobBytes: null
    })
    expect(suggestion).toEqual({
      limit: 4,
      budgetBytes: 10 * GIB,
      perJobBytes: UNMEASURED_JOB_BYTES,
      measured: false
    })
  })
})
