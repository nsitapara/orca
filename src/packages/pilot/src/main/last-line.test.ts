import { describe, expect, it } from 'vitest'
import { lastLine } from './last-line'

describe('lastLine', () => {
  it.each([
    ['one line', 'boom', 'boom'],
    ['trailing newlines and padding', 'a\n  b  \n\n', 'b'],
    ['blank lines between', 'a\n\n\nb', 'b'],
    ['nothing', '', ''],
    ['only whitespace', ' \n\t\n', '']
  ])('%s', (_name, text, expected) => {
    expect(lastLine(text)).toBe(expected)
  })
})
