import { describe, expect, it } from 'vitest'
import type { HoldReason, ItemFields } from '../api-types'
import { testDefinition } from '../definition/__fixtures__/definition'
import type { AutomationDefinition } from '../definition/types'
import { decideTick, type DecideInput, type DecideItem, type HandledState } from './decide'
import { DEFAULT_RETRY_AFTER_MS } from '../capacity/retry-limit'
import { itemGate, standingHold, type Hold } from './runner-gates'

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
    expect(hold && [hold.code, hold.detail]).toEqual(detail && ['own_run', detail])
  })
})

describe("Go now's mark on an item", () => {
  const PATH = '/wt/1'
  const MARKED: DecideItem = { ...ITEM, fields: { ...ITEM.fields, 'worktree.path': PATH } }
  const other = (path: string): DecideItem => ({
    key: 'mr:2',
    label: '!2',
    fields: { 'mr.iid': 2, 'worktree.path': path }
  })
  const job = (over: Partial<AutomationDefinition>) =>
    testDefinition({ oncePer: '{mr.iid}', ...over })
  const withFields = (fields: ItemFields): DecideItem => ({
    ...MARKED,
    fields: { ...MARKED.fields, ...fields }
  })
  // The marked item's hold as one tick decides it, with or without the mark on its line row.
  const tick =
    (over: Partial<DecideInput>) =>
    (goNow: boolean): Hold | null => {
      const given: DecideInput = {
        ...input({ status: 'done', failedAt: null, failures: 0, lastOutcome: null }),
        handled: new Map(),
        items: [MARKED],
        ...over,
        goNowKeys: new Set(goNow ? [MARKED.key] : [])
      }
      return decideTick(given).find((d) => d.key === MARKED.key)?.hold ?? null
    }
  // Admission (a free slot) and the Inbox's queue hold on these, never the runner's gates: the gates' rule alone.
  const elsewhere = (code: HoldReason) => (goNow: boolean) =>
    standingHold([{ code, detail: code }], goNow)

  type Gate = (goNow: boolean) => Hold | null
  // Every code a hold carries, through each gate that holds on it (`unmarked`: what holds it without the mark, when
  // that differs); goes: the mark passes over it. A Record, so a new code must say.
  const BY_CODE: Record<
    HoldReason,
    { goes: boolean; gates: (Gate | { unmarked: HoldReason; gate: Gate })[] }
  > = {
    retry: { goes: true, gates: [tick({ handled: new Map([['1', failed(1, 5 * MIN)]]) })] },
    quota: {
      goes: true,
      gates: [
        tick({
          definition: job({
            checks: [{ kind: 'quota', agent: 'claude', weekly: 50, session: 50 }]
          }),
          items: [withFields({ 'quota.claude.weekly_pct': 60 })]
        }),
        tick({ items: [withFields({ 'quota.claude.weekly_pct': 95 })] })
      ]
    },
    window: {
      goes: true,
      gates: [
        tick({ definition: job({ checks: [{ kind: 'window', start: '01:00', end: '02:00' }] }) })
      ]
    },
    job_limit: {
      goes: true,
      gates: [
        tick({
          definition: job({ limits: { ...job({}).limits, atOnce: 1 } }),
          activeRuns: 1
        })
      ]
    },
    tick_limit: {
      goes: true,
      gates: [
        tick({
          definition: job({ limits: { ...job({}).limits, perTick: 1 } }),
          items: [other('/wt/2'), MARKED]
        })
      ]
    },
    capacity: { goes: true, gates: [elsewhere('capacity')] },
    worktree_busy: {
      goes: false,
      gates: [tick({ busyWorktrees: new Set([PATH]) }), tick({ items: [other(PATH), MARKED] })]
    },
    own_run: {
      goes: false,
      gates: [
        tick({ activeItems: new Set([MARKED.key]) }),
        // A run-once job beside its own run in the main checkout: at_once holds it, and its run once Go now passes that.
        {
          unmarked: 'job_limit',
          gate: tick({
            definition: job({
              items: null,
              workspace: { kind: 'main_checkout' },
              limits: { ...job({}).limits, atOnce: 1 }
            }),
            activeRuns: 1,
            activeItems: new Set([MARKED.key])
          })
        }
      ]
    },
    session_open: {
      goes: false,
      gates: [
        tick({
          definition: job({ checks: [{ kind: 'session_none_open', scope: 'automation' }] })
        })
      ]
    },
    answers_pending: {
      goes: false,
      gates: [
        tick({
          definition: job({ checks: [{ kind: 'answers_none_pending' }] }),
          items: [withFields({ 'inbox.pending_answers': 2 })]
        })
      ]
    },
    in_flight: { goes: false, gates: [elsewhere('in_flight')] },
    claimed: { goes: false, gates: [elsewhere('claimed')] },
    typing: { goes: false, gates: [elsewhere('typing')] },
    no_worktree: { goes: false, gates: [elsewhere('no_worktree')] },
    mr_unknown: { goes: false, gates: [elsewhere('mr_unknown')] },
    waits: { goes: false, gates: [elsewhere('waits')] }
  }

  it.each(Object.entries(BY_CODE))('a %s hold', (code, { goes, gates }) => {
    for (const entry of gates) {
      const { gate, unmarked } =
        typeof entry === 'function' ? { gate: entry, unmarked: code } : entry
      expect(gate(false)?.code).toBe(unmarked)
      expect(gate(true)?.code).toBe(goes ? undefined : code)
    }
  })

  it('still names the safety hold behind a wait it passes over', () => {
    const both = tick({
      handled: new Map([['1', failed(1, 5 * MIN)]]),
      activeItems: new Set([MARKED.key])
    })
    expect([both(false)?.code, both(true)?.code]).toEqual(['retry', 'own_run'])
  })
})
