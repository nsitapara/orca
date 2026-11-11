import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ItemSource } from './types'
import { itemSource, registerItemSource } from './registry'

// The registered source lives in the registry module; a shared test worker must load it fresh next.
afterAll(() => {
  vi.resetModules()
})

describe('item source registry', () => {
  it('has the merge request source built in, and takes registered sources', () => {
    expect(itemSource('merge_request').kind).toBe('merge_request')
    expect(() => itemSource('worktree')).toThrow("Pilot can't list worktree items yet")
    const fake = { kind: 'worktree' } as unknown as ItemSource
    registerItemSource(fake)
    expect(itemSource('worktree')).toBe(fake)
  })
})
