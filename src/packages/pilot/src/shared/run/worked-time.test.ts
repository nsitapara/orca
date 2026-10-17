import { describe, expect, it } from 'vitest'
import { workedMs } from './worked-time'

describe('workedMs', () => {
  it.each([
    ['a run never continued', { startedAt: 100 }, 400, 300],
    ['a run that sat ended before Continue run', { startedAt: 100, idleMs: 200 }, 400, 100],
    ['never below zero', { startedAt: 100, idleMs: 500 }, 400, 0]
  ])('%s', (_name, run, until, ms) => {
    expect(workedMs(run, until)).toBe(ms)
  })
})
