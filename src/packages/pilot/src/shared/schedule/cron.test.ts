import { describe, expect, it } from 'vitest'
import { isValidTimeZone, nextTickAfter, parseCron } from './cron'

const LA = 'America/Los_Angeles'
function ticks(expr: string, from: string, n: number): string[] {
  const out: string[] = []
  let t = new Date(from)
  for (let i = 0; i < n; i++) {
    const next = nextTickAfter(expr, LA, t)
    if (!next) {
      break
    }
    out.push(next.toISOString())
    t = next
  }
  return out
}

describe('nextTickAfter', () => {
  it('fires at :10 every hour', () => {
    expect(ticks('10 * * * *', '2026-10-10T19:00:00Z', 2)).toEqual([
      '2026-10-10T19:10:00.000Z',
      '2026-10-10T20:10:00.000Z'
    ])
  })

  it('fires twice at the repeated 1:10 AM when clocks fall back (Review Focus 2)', () => {
    // 2026-11-01: 01:05 PDT = 08:05Z; 1:10 PDT = 08:10Z; fall back at 09:00Z; 1:10 PST = 09:10Z; 2:10 PST = 10:10Z
    expect(ticks('10 * * * *', '2026-11-01T08:05:00Z', 3)).toEqual([
      '2026-11-01T08:10:00.000Z',
      '2026-11-01T09:10:00.000Z',
      '2026-11-01T10:10:00.000Z'
    ])
  })

  it('skips the 2:10 AM that does not exist when clocks spring forward', () => {
    // 2027-03-14: 1:10 PST = 09:10Z; 2:00 PST jumps to 3:00 PDT; 3:10 PDT = 10:10Z
    expect(ticks('10 * * * *', '2027-03-14T09:05:00Z', 2)).toEqual([
      '2027-03-14T09:10:00.000Z',
      '2027-03-14T10:10:00.000Z'
    ])
  })

  it('fires a daily 3:00 AM once on the fall-back day', () => {
    expect(ticks('0 3 * * *', '2026-11-01T00:00:00Z', 2)).toEqual([
      '2026-11-01T11:00:00.000Z',
      '2026-11-02T11:00:00.000Z'
    ])
  })

  it('supports steps, ranges and lists (04: every 20 min, 2-7 AM)', () => {
    expect(ticks('*/20 2-7 * * *', '2026-10-10T09:00:00Z', 3)).toEqual([
      '2026-10-10T09:20:00.000Z',
      '2026-10-10T09:40:00.000Z',
      '2026-10-10T10:00:00.000Z'
    ])
  })

  it('supports weekdays (dow)', () => {
    // 2026-10-10 is a Saturday; next weekday 8:00 PDT is Monday 2026-10-12 15:00Z
    expect(ticks('0 8 * * 1-5', '2026-10-10T19:00:00Z', 1)).toEqual(['2026-10-12T15:00:00.000Z'])
  })

  it('returns null for an expression that never matches', () => {
    expect(nextTickAfter('0 0 30 2 *', LA, new Date('2026-10-10T00:00:00Z'))).toBeNull()
  })

  it('finds a yearly tick from mid-year in reasonable time', () => {
    const start = performance.now()
    const next = nextTickAfter('0 0 1 1 *', LA, new Date('2026-07-01T00:00:00Z'))
    const ms = performance.now() - start
    expect(next?.toISOString()).toBe('2027-01-01T08:00:00.000Z')
    expect(ms).toBeLessThan(2000)
  })
})

describe('parseCron', () => {
  it.each([
    ['* * *', 'expected 5 fields (minute hour day month weekday), got 3'],
    ['61 * * * *', 'minute: 61 is out of range 0-59'],
    ['*/0 * * * *', 'minute: step must be at least 1'],
    ['a * * * *', 'minute: "a" is not a number']
  ])('%s -> %s', (expr, message) => {
    expect(() => parseCron(expr)).toThrow(message)
  })
})

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects others', () => {
    expect(isValidTimeZone('America/Los_Angeles')).toBe(true)
    expect(isValidTimeZone('Mars/Base')).toBe(false)
  })
})
