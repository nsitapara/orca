import { describe, expect, it } from 'vitest'
import { testDefinition } from '../definition/__fixtures__/definition'
import type { DecideInput, DecideItem, HandledState } from './decide'
import { DEFAULT_RETRY_AFTER_MS } from '../capacity/retry-limit'
import { itemGate } from './runner-gates'

const NOW = Date.UTC(2026, 9, 11, 19, 0)
const MIN = 60_000
const ITEM: DecideItem = { key: 'mr:1', label: '!1', fields: { 'mr.iid': 1 } }

function failed(failures: number, ago: number): HandledState {
  return { status: 'failed', failedAt: NOW - ago, failures, lastOutcome: 'agent exited' }
}

function input(state: HandledState, over: Partial<DecideInput> = {}): DecideInput {
  return {
    definition: testDefinition({ oncePer: '{mr.iid}' }),
    items: [ITEM],
    now: NOW,
    scope: new Map(),
    handled: new Map([['1', state]]),
    seenKeys: new Set(),
    activeRuns: 0,
    busyWorktrees: new Set(),
    scriptChecks: new Map(),
    retryLimit: 2,
    byHand: false,
    ...over
  }
}

describe('itemGate: the retry gate', () => {
  it('waits 10 minutes after a failure when the job sets no retry_after_failure', () => {
    expect(DEFAULT_RETRY_AFTER_MS).toBe(600_000)
  })

  it.each<[string, DecideInput, RegExp | null]>([
    [
      'a first failure 5 min ago',
      input(failed(1, 5 * MIN)),
      /^Retry 1 of 2 at \d{1,2}:\d{2}\. Last run failed: agent exited$/
    ],
    ['a first failure 11 min ago', input(failed(1, 11 * MIN)), null],
    [
      "inside the job's own retry_after_failure",
      input(failed(2, 20 * MIN), {
        definition: testDefinition({ oncePer: '{mr.iid}', retryAfterFailureMs: 30 * MIN })
      }),
      /^Retry 2 of 2 at \d{1,2}:\d{2}\. Last run failed: agent exited$/
    ],
    ['past the limit, by hand', input(failed(3, MIN), { byHand: true }), null],
    [
      'a key that is done',
      input({ status: 'done', failedAt: null, failures: 0, lastOutcome: null }),
      null
    ]
  ])('%s', (_name, given, detail) => {
    const hold = itemGate(given, ITEM, '1', null)
    if (detail === null) {
      expect(hold).toBeNull()
      return
    }
    expect(hold?.code).toBe('retry')
    expect(hold?.detail).toMatch(detail)
  })

  it('says when its wait ends, so the line re-checks it then', () => {
    expect(itemGate(input(failed(1, 5 * MIN)), ITEM, '1', null)?.until).toBe(
      NOW - 5 * MIN + DEFAULT_RETRY_AFTER_MS
    )
  })

  it("names the time on the job's clock", () => {
    // 19:05 UTC is 12:05 in Los Angeles, the fixture's timezone.
    expect(itemGate(input(failed(1, 5 * MIN)), ITEM, '1', null)?.detail).toBe(
      'Retry 1 of 2 at 12:05. Last run failed: agent exited'
    )
  })

  it('goes before the runtime checks, so a held retry names its wait', () => {
    const def = testDefinition({ oncePer: '{mr.iid}', checks: [{ kind: 'answers_none_pending' }] })
    const pending: DecideItem = { ...ITEM, fields: { ...ITEM.fields, 'inbox.pending_answers': 2 } }
    expect(itemGate(input(failed(1, MIN), { definition: def }), pending, '1', null)?.code).toBe(
      'retry'
    )
  })
})

describe("itemGate: the job's own run on the item", () => {
  const done: HandledState = { status: 'done', failedAt: null, failures: 0, lastOutcome: null }
  it.each<[string, Partial<DecideInput>, string | null]>([
    [
      'still running on this item',
      { activeItems: new Set([ITEM.key]) },
      'Another run of this job is still active on !1'
    ],
    ['running on another item', { activeItems: new Set(['mr:2']) }, null],
    [
      'a run-once job, which at_once paces',
      { activeItems: new Set([ITEM.key]), definition: testDefinition({ items: null }) },
      null
    ]
  ])('%s', (_name, over, detail) => {
    const hold = itemGate(input(done, over), ITEM, '1', null)
    expect(hold && [hold.code, hold.detail]).toEqual(detail && ['job_limit', detail])
  })
})
