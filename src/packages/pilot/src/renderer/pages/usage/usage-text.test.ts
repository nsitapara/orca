import { describe, expect, it } from 'vitest'
import { shareText, weekStartDay, whenText } from './usage-text'

const at = (d: number, h: number, m = 0): number => new Date(2026, 9, d, h, m).getTime()

describe('usage-text', () => {
  it.each([
    ['a week ending Oct 27 02:21', { resetsAt: at(27, 2, 21), windowMinutes: 10080 }, '2026-10-20'],
    ['a window with no reset yet', { resetsAt: null, windowMinutes: 10080 }, null]
  ])('weekStartDay: %s → %s', (_name, window, day) => {
    expect(weekStartDay({ usedPercent: 49, resetDescription: null, ...window })).toBe(day)
  })

  it.each([
    [113.29, 159.16, '71%'],
    [null, 159.16, ''],
    [5, 0, '']
  ])('shareText(%s, %s) → %s', (part, whole, text) => {
    expect(shareText(part, whole)).toBe(text)
  })

  it('says how long ago within a day, and the date after', () => {
    const now = at(20, 15)
    expect(whenText(at(20, 12), now)).toBe('3 h ago')
    expect(whenText(at(16, 9, 2), now)).toMatch(/Oct 16.*9:02/)
  })
})
