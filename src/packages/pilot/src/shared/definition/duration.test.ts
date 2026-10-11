import { describe, expect, it } from 'vitest'
import { durationMs, durationSchema } from './duration'

describe('durationMs', () => {
  it.each([
    ['30s', 30_000],
    ['10m', 600_000],
    ['12h', 43_200_000],
    ['2d', 172_800_000],
    ['0s', null],
    ['1.5h', null],
    ['12', null],
    ['h', null],
    ['12 h', null],
    ['12H', null]
  ])('%s -> %s', (text, ms) => {
    expect(durationMs(text)).toBe(ms)
  })

  it('parses a duration in a schema, and names the format when it is not one', () => {
    expect(durationSchema.parse('60m')).toBe(3_600_000)
    const bad = durationSchema.safeParse('an hour')
    expect(bad.success ? '' : bad.error.issues[0].message).toBe(
      'expected a duration like 30s, 10m, 12h or 2d'
    )
  })
})
