import { describe, expect, it } from 'vitest'
import { parseMemAvailable, parseVmStat } from './system-memory'

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                9000.
Pages active:                            500000.
Pages inactive:                          400000.
Pages speculative:                         1000.
Pages throttled:                              0.
Pages wired down:                        200000.
Pages purgeable:                          30000.
`

describe('parseVmStat', () => {
  it.each([
    [
      'free + inactive + speculative pages times the page size',
      VM_STAT,
      (9000 + 400000 + 1000) * 16384
    ],
    ['a missing page kind as zero', 'page size of 4096 bytes\nPages free: 10.\n', 10 * 4096],
    ['null without the page size', 'Pages free: 10.\n', null]
  ])('counts %s', (_name, text, expected) => {
    expect(parseVmStat(text)).toBe(expected)
  })
})

describe('parseMemAvailable', () => {
  it.each([
    ['MemTotal:       32000000 kB\nMemAvailable:   12000000 kB\n', 12000000 * 1024],
    ['MemTotal:       32000000 kB\n', null]
  ])('reads %j', (text, expected) => {
    expect(parseMemAvailable(text)).toBe(expected)
  })
})
