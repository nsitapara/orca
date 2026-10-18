import { describe, expect, it } from 'vitest'
import type { CapacityPayload, CapacityRun } from '../../../shared/api-types-capacity'
import { endedText, memoryText, runMemoryText, suggestionText, usageText } from './running-text'

const GIB = 1024 ** 3

const run = (over: Partial<CapacityRun> = {}): CapacityRun => ({
  id: 'r1',
  automationId: 'a',
  automationName: 'A',
  itemLabel: '!1',
  startedAt: 0,
  memoryBytes: null,
  peakBytes: null,
  counted: true,
  ...over
})

const payload = (over: Partial<CapacityPayload> = {}): CapacityPayload => ({
  limit: 3,
  running: [run(), run({ id: 'r2', counted: false })],
  queued: [],
  finished: [],
  memory: { totalBytes: 24 * GIB, availableBytes: 10 * GIB },
  suggestion: { limit: 3, budgetBytes: 6.5 * GIB, perJobBytes: 2 * GIB, measured: true },
  heaviest: {
    automationId: 'a',
    automationName: '03 Review and fix',
    peakBytes: 2 * GIB,
    measured: true
  },
  ...over
})

const waiting = {
  automationId: 'b',
  automationName: 'B',
  itemKey: 'k',
  itemLabel: '!2',
  queuedAt: 0,
  byHand: false
}

describe('usageText', () => {
  it.each([
    ['slots in use, counting only runs that hold one', payload(), '1 of 3 in use'],
    ['no limit', payload({ limit: null }), '1 running, no limit'],
    ['the waiting items', payload({ queued: [waiting, waiting] }), '1 of 3 in use · 2 waiting'],
    [
      'held items apart from slot waiters',
      payload({
        queued: [waiting, { ...waiting, holdCode: 'quota' }, { ...waiting, holdCode: 'window' }]
      }),
      '1 of 3 in use · 1 waiting for a slot · 2 held'
    ],
    [
      'only held items',
      payload({ queued: [{ ...waiting, holdCode: 'quota' }] }),
      '1 of 3 in use · 1 held'
    ],
    [
      'runs past a lowered limit',
      payload({ limit: 1, running: [run(), run({ id: 'r3' })] }),
      '2 running, over the limit of 1'
    ]
  ])('says %s', (_name, p, expected) => {
    expect(usageText(p)).toBe(expected)
  })
})

describe('memoryText', () => {
  it.each([
    ['what is available', payload(), 'Memory: 10.0 GB available of 24.0 GB'],
    [
      'what measured running jobs hold, never a run that takes no slot',
      payload({
        running: [
          run({ memoryBytes: 1.5 * GIB }),
          run({ id: 'r2', memoryBytes: 0.5 * GIB }),
          run({ id: 'r3', counted: false, memoryBytes: 4 * GIB })
        ]
      }),
      'Memory: 10.0 GB available of 24.0 GB · running jobs hold 2.0 GB'
    ],
    ['nothing when memory cannot be read', payload({ memory: null }), null]
  ])('says %s', (_name, p, expected) => {
    expect(memoryText(p)).toBe(expected)
  })
})

describe('suggestionText', () => {
  it('names the heaviest job and the memory jobs can use', () => {
    expect(suggestionText(payload())).toBe(
      "The heaviest job, 03 Review and fix, peaked at 2.0 GB, and 6.5 GB can go to jobs: what's available plus what running jobs hold, less 4.0 GB kept free."
    )
  })

  it('names a job not measured yet when it is the one budgeted for', () => {
    const p = payload({
      heaviest: {
        automationId: 'b',
        automationName: '04 Test UIs',
        peakBytes: 2.5 * GIB,
        measured: false
      },
      suggestion: { limit: 4, budgetBytes: 10 * GIB, perJobBytes: 2.5 * GIB, measured: false }
    })
    expect(suggestionText(p)).toMatch(
      /^04 Test UIs hasn't been measured yet, so each job counts as 2\.5 GB, and 10\.0 GB/
    )
  })

  it('says what an unmeasured job counts as', () => {
    const p = payload({
      heaviest: null,
      suggestion: { limit: 4, budgetBytes: 10 * GIB, perJobBytes: 2.5 * GIB, measured: false }
    })
    expect(suggestionText(p)).toMatch(
      /^No job has been measured yet, so each counts as 2\.5 GB, and 10\.0 GB/
    )
  })
})

describe('runMemoryText', () => {
  it.each([
    [
      'a run of a job that holds no slot',
      run({ counted: false, memoryBytes: GIB }),
      'takes no slot'
    ],
    ['a run not sampled yet', run(), 'not measured yet'],
    ['a run sampled before, not now', run({ peakBytes: GIB }), 'peak 1.0 GB'],
    ['a run sampled now', run({ memoryBytes: 0.5 * GIB, peakBytes: GIB }), '512 MB · peak 1.0 GB']
  ])('shows %s', (_name, r, expected) => {
    expect(runMemoryText(r)).toBe(expected)
  })
})

describe('endedText', () => {
  const now = new Date(2026, 9, 17, 15, 0).getTime()
  const time = (ms: number): string =>
    new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  it.each([
    ['earlier today', new Date(2026, 9, 17, 14, 41).getTime(), false],
    ['yesterday', new Date(2026, 9, 16, 23, 5).getTime(), true]
  ])('shows a run that ended %s with the date only before today', (_name, ended, dated) => {
    const text = endedText(ended, now)
    expect(text.endsWith(time(ended))).toBe(true)
    expect(text === time(ended)).toBe(!dated)
  })
})
