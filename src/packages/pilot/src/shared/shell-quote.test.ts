import { describe, expect, it } from 'vitest'
import { shellQuote } from './shell-quote'

describe('shellQuote', () => {
  it.each([
    ['plain', "'plain'"],
    ['a b', "'a b'"],
    ["it's", `'it'\\''s'`],
    ['', "''"]
  ])('%j', (value, quoted) => {
    expect(shellQuote(value)).toBe(quoted)
  })
})
