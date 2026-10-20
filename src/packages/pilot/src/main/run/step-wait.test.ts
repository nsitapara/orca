import { describe, expect, it } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { endsAtStart } from './step-wait'

describe('endsAtStart', () => {
  const def = testDefinition({ steps: [testStep(), testStep({ wait: 'start' })] })

  it.each([
    ['a finish step', def, 'schedule', 0, false],
    ['a start step', def, 'schedule', 1, true],
    ['an answer run, whose step is no definition step', def, 'answer', 1, false],
    ['a missing definition', null, 'schedule', 1, false],
    ['an index past the steps', def, 'schedule', 5, false]
  ] as const)('%s', (_name, d, trigger, idx, expected) => {
    expect(endsAtStart(d, { trigger }, idx)).toBe(expected)
  })
})
