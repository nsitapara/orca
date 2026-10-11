import { describe, expect, it } from 'vitest'
import { checkInboxOption, parseParts, parseSwitchWords } from './inbox-args'

describe('checkInboxOption', () => {
  it.each([['Push — publish both commits'], ['Hold'], ['Rebase — onto dev — then push']])(
    'passes %j through for the server to parse',
    (raw) => {
      expect(checkInboxOption(raw)).toBe(raw)
    }
  )

  it.each([
    [' — means nothing', '--option " — means nothing" has no label before " — "'],
    ['   ', '--option "   " has no label']
  ])('refuses %j', (raw, message) => expect(() => checkInboxOption(raw)).toThrow(message))
})

describe('parseParts', () => {
  it('reads <id>=<label> pairs, splitting at the first =', () => {
    expect(parseParts(['a=Fix one', 'b=Fix = two'])).toEqual({ a: 'Fix one', b: 'Fix = two' })
  })

  it.each([
    [['nolabel'], '--part "nolabel" isn\'t <id>=<label>'],
    [['=x'], '--part "=x" isn\'t <id>=<label>'],
    [['a='], '--part "a=" isn\'t <id>=<label>'],
    [['a=x', 'a=y'], '--part a is given twice']
  ])('refuses %j', (pairs, message) => expect(() => parseParts(pairs)).toThrow(message))
})

describe('parseSwitchWords', () => {
  it('is none when no --switch is given, and on then off when it is given twice', () => {
    expect(parseSwitchWords([])).toEqual([])
    expect(parseSwitchWords(['Post', 'Leave out'])).toEqual(['Post', 'Leave out'])
  })

  it.each([[['Post']], [['a', 'b', 'c']], [['Post', ' ']]])('refuses %j', (words) => {
    expect(() => parseSwitchWords(words)).toThrow(
      'Give --switch twice: the word for on, then the word for off'
    )
  })
})
