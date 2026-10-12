import { describe, expect, it } from 'vitest'
import type { ItemFields } from '../api-types'
import { firstSight } from './decide'

describe('firstSight', () => {
  it.each([
    ['unseen, the source says nothing', {}, false, true],
    ['seen, the source says nothing', {}, true, false],
    ['seen, but its history was rewritten (03 rebaselines)', { 'item.baseline': true }, true, true],
    ['unseen, but its new work is recent (04 tests it)', { 'item.baseline': false }, false, false]
  ] as [string, ItemFields, boolean, boolean][])('%s', (_name, fields, seen, want) => {
    const seenKeys = new Set(seen ? ['wt:x'] : [])
    expect(firstSight({ key: 'wt:x', fields }, seenKeys)).toBe(want)
  })
})
