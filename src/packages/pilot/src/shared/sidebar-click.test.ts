import { describe, expect, it } from 'vitest'
import { resolveActivityClick } from './sidebar-click'

describe('resolveActivityClick', () => {
  it.each([
    [{ tab: 'checks', effectiveTab: 'checks', open: true }, 'close'],
    [{ tab: 'checks', effectiveTab: 'checks', open: false }, 'open'],
    [{ tab: 'plugin:pilot', effectiveTab: 'checks', open: false }, 'open'],
    [{ tab: 'plugin:pilot', effectiveTab: 'checks', open: true }, 'select']
  ])('%o → %s', (input, expected) => {
    expect(resolveActivityClick(input)).toBe(expected)
  })
})
