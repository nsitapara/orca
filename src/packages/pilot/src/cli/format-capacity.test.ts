import { describe, expect, it } from 'vitest'
import type { CapacityPayload } from '../shared/api-types-capacity'
import { formatCapacity } from './format-capacity'

const GIB = 1024 ** 3
const NOW = 10 * 60_000

const payload: CapacityPayload = {
  limit: 2,
  running: [
    {
      id: 'r1',
      automationId: 'review',
      automationName: '03 Review and fix',
      itemLabel: '!1655',
      startedAt: NOW - 5 * 60_000,
      memoryBytes: 1.5 * GIB,
      peakBytes: 2 * GIB,
      counted: true
    },
    {
      id: 'p1',
      automationId: 'pull',
      automationName: '01 Pull dev',
      itemLabel: 'dev',
      startedAt: NOW - 30_000,
      memoryBytes: null,
      peakBytes: null,
      counted: false
    }
  ],
  queued: [
    {
      automationId: 'ci',
      automationName: '05 Fix failed CI',
      itemKey: 'mr:9',
      itemLabel: '!9',
      queuedAt: NOW - 3 * 60_000,
      byHand: true
    }
  ],
  finished: [],
  memory: { totalBytes: 24 * GIB, availableBytes: 9.5 * GIB },
  suggestion: { limit: 3, budgetBytes: 7 * GIB, perJobBytes: 2 * GIB, measured: true },
  heaviest: {
    automationId: 'review',
    automationName: '03 Review and fix',
    peakBytes: 2 * GIB,
    measured: true
  }
}

describe('formatCapacity', () => {
  it('says the limit, what runs and waits in line, and the suggestion with its reason', () => {
    expect(formatCapacity(payload, NOW)).toBe(
      [
        'Run limit: 2 (suggested 3)',
        'Running: 1 of 2',
        '  03 Review and fix  !1655  5m  1.5 GB (peak 2.0 GB)',
        '  01 Pull dev  dev  30s  takes no slot',
        'Waiting: 1',
        '  1. 05 Fix failed CI  !9  waiting 3m  (Run now)',
        'Memory: 9.5 GB available of 24.0 GB',
        'Suggestion: 3, heaviest job 03 Review and fix peaked at 2.0 GB'
      ].join('\n')
    )
  })

  it('says when there is no limit and no job has been measured yet', () => {
    const text = formatCapacity(
      {
        ...payload,
        limit: null,
        heaviest: null,
        suggestion: { ...payload.suggestion, perJobBytes: 2.5 * GIB, measured: false }
      },
      NOW
    )
    expect(text.split('\n').slice(0, 2)).toEqual([
      'Run limit: no limit (suggested 3)',
      'Running: 1'
    ])
    expect(text.split('\n').at(-1)).toBe('Suggestion: 3, no job measured yet, so 2.5 GB each')
  })

  it('names the job not measured yet that the suggestion budgets for', () => {
    const text = formatCapacity(
      {
        ...payload,
        heaviest: { ...payload.heaviest!, automationName: '04 Test UIs', measured: false },
        suggestion: { ...payload.suggestion, perJobBytes: 2.5 * GIB, measured: false }
      },
      NOW
    )
    expect(text.split('\n').at(-1)).toBe(
      'Suggestion: 3, 04 Test UIs not measured yet, so 2.5 GB each'
    )
  })
})
