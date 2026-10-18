import { describe, expect, it } from 'vitest'
import { checkInboxOption } from './inbox-args'

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
