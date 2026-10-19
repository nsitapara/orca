import { describe, expect, it } from 'vitest'
import type { CapacityPayload, QueuedRun } from '../../../shared/api-types-capacity'
import { checkNow, checkOf, quotaUseText, RUNNER_CHECKS } from './running-checks'

const row = (over: Partial<QueuedRun>): QueuedRun => ({
  automationId: 'a',
  automationName: 'A',
  itemKey: 'k',
  itemLabel: 'k',
  queuedAt: 0,
  byHand: false,
  ...over
})

const payload = (over: Partial<CapacityPayload> = {}): CapacityPayload => ({
  limit: 1,
  running: [
    {
      id: 'r1',
      automationId: 'a',
      automationName: 'A',
      itemLabel: '!1',
      startedAt: 0,
      memoryBytes: null,
      peakBytes: null,
      counted: true
    }
  ],
  queued: [],
  finished: [],
  memory: null,
  suggestion: { limit: 1, budgetBytes: 0, perJobBytes: 0, measured: false },
  heaviest: null,
  quotaCeiling: { weekly: 90, session: 95 },
  ...over
})

const named = (name: string) => {
  const check = RUNNER_CHECKS.find((c) => c.name === name)
  if (!check) {
    throw new Error(name)
  }
  return check
}

describe('checkNow', () => {
  it.each<[string, string, Partial<CapacityPayload>, string, boolean]>([
    ['a retry with none waiting', 'Retry wait', {}, 'none waiting', false],
    ['a retry waiting', 'Retry wait', { queued: [row({ holdCode: 'retry' })] }, 'waiting 1', true],
    [
      "the job's gates across their codes",
      "The job's own gates",
      { queued: [row({ holdCode: 'window' }), row({ holdCode: 'session_open' })] },
      'holding 2',
      true
    ],
    [
      'quota with who is past the ceiling',
      'Agent quota',
      {
        queued: [row({ holdCode: 'quota' })],
        quotaUse: { claude: { weekly: 92, session: 10 }, codex: { weekly: 12, session: null } }
      },
      'holding 1: Claude 92% weekly',
      true
    ],
    ['its own run', 'Its own run', { queued: [row({ holdCode: 'own_run' })] }, 'holding 1', true],
    [
      'slots used with a line',
      'Jobs at once',
      { queued: [row({ holdCode: 'capacity' })] },
      '1 of 1 used · 1 in line',
      true
    ],
    [
      'an older row naming no hold, in the slot line',
      'Jobs at once',
      { queued: [row({})] },
      '1 of 1 used · 1 in line',
      true
    ],
    ['no limit', 'Jobs at once', { limit: null }, '1 running, no limit', false]
  ])('%s', (_name, check, over, text, holding) => {
    expect(checkNow(named(check), payload(over))).toEqual({ text, holding })
  })
})

describe('checkOf', () => {
  it.each([
    ['tick_limit', 'Job limits'],
    ['worktree_busy', 'Busy worktree'],
    ['typing', null],
    [undefined, null]
  ] as const)('names %s as %s', (code, name) => {
    expect(checkOf(code)?.name ?? null).toBe(name)
  })
})

describe('quotaUseText', () => {
  it.each<[string, Partial<CapacityPayload>, string | null]>([
    [
      'an agent past its session ceiling',
      { quotaUse: { codex: { weekly: 40, session: 96 } } },
      'Codex 96% session now: agent steps wait'
    ],
    [
      'every weekly figure when none is past',
      { quotaUse: { claude: { weekly: 47.4, session: 3 }, codex: { weekly: 12, session: 1 } } },
      'Claude 47% · Codex 12% weekly now'
    ],
    ['nothing from an older Pilot', {}, null]
  ])('says %s', (_name, over, text) => {
    expect(quotaUseText(payload(over))).toBe(text)
  })
})
