import { describe, expect, it } from 'vitest'
import { HEADROOM_BYTES, MIN_JOB_BYTES, UNMEASURED_JOB_BYTES } from './limit-suggestion'
import { fitsMemory, reserveOf, spareBytes } from './memory-reserve'

const GIB = 1024 ** 3

describe('reserveOf', () => {
  it.each([
    ['an unmeasured job at a stack', [], { bytes: UNMEASURED_JOB_BYTES, measured: false }],
    ['one run at its peak', [3 * GIB], { bytes: 3 * GIB, measured: true }],
    [
      'twenty runs at the 18th, past two spikes',
      [...Array.from({ length: 18 }, (_, i) => (i + 1) * 0.1 * GIB), 6 * GIB, 7 * GIB],
      { bytes: 1.8 * GIB, measured: true }
    ],
    ['a near-empty job at the floor', [1], { bytes: MIN_JOB_BYTES, measured: true }]
  ])('reserves %s', (_name, peaks, expected) => {
    expect(reserveOf(peaks)).toEqual(expected)
  })
})

describe('spareBytes', () => {
  it.each([
    ['nothing running', 10, [], 10],
    ['a running job still under its reserve', 10, [{ reserveBytes: 3, memoryBytes: 1 }], 8],
    ['an unsampled job at its whole reserve', 10, [{ reserveBytes: 3, memoryBytes: null }], 7],
    ['a job past its reserve freeing nothing', 10, [{ reserveBytes: 1, memoryBytes: 2 }], 10]
  ])('counts %s, less the headroom', (_name, availableGib, running, expectedGib) => {
    const held = running.map((r) => ({
      reserveBytes: r.reserveBytes * GIB,
      memoryBytes: r.memoryBytes === null ? null : r.memoryBytes * GIB
    }))
    expect(spareBytes(availableGib * GIB, held)).toBe(expectedGib * GIB - HEADROOM_BYTES)
  })
})

describe('fitsMemory', () => {
  it.each([
    ['fits the spare', 2, 3, 1, true],
    ['past the spare beside a running job', 4, 3, 1, false],
    ['past the spare with nothing running', 9, -1, 0, true]
  ])('%s', (_name, reserve, spare, running, expected) => {
    expect(fitsMemory(reserve, spare, running)).toBe(expected)
  })
})
