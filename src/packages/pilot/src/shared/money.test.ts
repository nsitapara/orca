import { describe, expect, it } from 'vitest'
import { fmtTokens, money } from './money'

describe('money', () => {
  it.each([
    [null, '—'],
    [0, '$0.00'],
    [1.954, '$1.95']
  ])('%s → %s', (v, s) => expect(money(v)).toBe(s))
})

describe('fmtTokens (usage.py fmt_tokens)', () => {
  it.each([
    [999, '999'],
    [1_000, '1.0k'],
    [1_200_350, '1.2M'],
    [3_400_000_000, '3.4B']
  ])('%s → %s', (n, s) => expect(fmtTokens(n)).toBe(s))
})
