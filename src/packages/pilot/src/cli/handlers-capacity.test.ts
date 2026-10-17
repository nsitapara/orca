import { describe, expect, it } from 'vitest'
import { parseRunLimit } from './handlers-capacity'

describe('parseRunLimit', () => {
  it.each([
    ['none', null],
    ['1', 1],
    ['10', 10]
  ])('reads %s', (text, expected) => {
    expect(parseRunLimit(text)).toBe(expected)
  })

  it.each(['0', '11', '2.5', '-1', 'three', ''])('refuses %j', (text) => {
    expect(() => parseRunLimit(text)).toThrow('--set takes a number from 1 to 10, or none')
  })
})
