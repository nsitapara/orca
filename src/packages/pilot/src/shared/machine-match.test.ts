import { describe, expect, it } from 'vitest'
import { sameMachine } from './machine-match'

describe('sameMachine', () => {
  it.each([
    ['Mac mini', ' mac MINI ', true],
    ['Mac mini', 'Mac-mini', false]
  ])('%s vs %s → %s', (a, b, same) => {
    expect(sameMachine(a, b)).toBe(same)
  })
})
