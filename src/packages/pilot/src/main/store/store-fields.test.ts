import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'

describe('FieldCacheStore', () => {
  it.each([
    ['a string', 'spec/a.rb'],
    ['a number', 3],
    ['true', true],
    ['null', null]
  ] as const)('returns %s it cached under the same key', (_label, value) => {
    const { fields } = PilotStore.open(':memory:')
    fields.set('a', 'failed_specs', 'mr:1', 'sha1', value, 10)
    expect(fields.get('a', 'failed_specs', 'mr:1', 'sha1')).toEqual({ value, at: 10 })
  })

  it('keeps one value per automation, field and item: a new cache key replaces the old one', () => {
    const { fields } = PilotStore.open(':memory:')
    fields.set('a', 'f', 'mr:1', 'pass-1', 1, 10)
    fields.set('a', 'f', 'mr:2', 'pass-1', 2, 10)
    fields.set('a', 'g', 'mr:1', 'pass-1', 3, 10)
    fields.set('a', 'f', 'mr:1', 'pass-2', 4, 20)
    expect(fields.get('a', 'f', 'mr:1', 'pass-1')).toBeNull()
    expect(fields.get('a', 'f', 'mr:1', 'pass-2')).toEqual({ value: 4, at: 20 })
    expect(fields.get('a', 'f', 'mr:2', 'pass-1')).toEqual({ value: 2, at: 10 })
    expect(fields.get('a', 'g', 'mr:1', 'pass-1')).toEqual({ value: 3, at: 10 })
    expect(fields.get('b', 'f', 'mr:1', 'pass-2')).toBeNull()
  })

  it('stores one row per automation, field and item however many keys it has seen', () => {
    const store = PilotStore.open(':memory:')
    for (const pass of ['pass-1', 'pass-2', 'pass-3']) {
      store.fields.set('a', 'f', 'mr:1', pass, 1, 10)
    }
    store.fields.set('a', 'f', 'mr:2', 'pass-3', 2, 10)
    expect(store.fields.get('a', 'f', 'mr:2', 'pass-3')).toEqual({ value: 2, at: 10 })
    expect(store.fields.get('a', 'f', 'mr:1', 'pass-1')).toBeNull()
  })
})
