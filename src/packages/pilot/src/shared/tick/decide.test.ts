import { describe, expect, it } from 'vitest'
import type { ItemFields } from '../api-types'
import { testDefinition, testStep } from '../definition/__fixtures__/definition'
import type { AutomationDefinition } from '../definition/types'
import {
  decideTick,
  usesHandled,
  workspacePathOf,
  type DecideInput,
  type DecideItem,
  type HandledState
} from './decide'

const NOW = Date.UTC(2026, 9, 11, 19, 0)
const HOUR = 60 * 60_000
const EXISTS = [{ kind: 'worktree_exists' as const }]

const item = (
  n: number,
  fields: ItemFields = {},
  sortKeys?: DecideItem['sortKeys']
): DecideItem => ({
  key: `mr:${n}`,
  label: `!${n}`,
  fields: { 'mr.iid': n, 'worktree.path': `/wt/${n}`, 'repo.path': '/repo', ...fields },
  ...(sortKeys ? { sortKeys } : {})
})

function input(
  definition: AutomationDefinition,
  items: DecideItem[],
  over: Partial<DecideInput> = {}
): DecideInput {
  return {
    definition,
    items,
    now: NOW,
    scope: new Map(),
    handled: new Map(),
    seenKeys: new Set(),
    activeRuns: 0,
    busyWorktrees: new Set(),
    scriptChecks: new Map(),
    retryLimit: 2,
    byHand: false,
    ...over
  }
}
const handledAs = (status: HandledState['status']): HandledState => ({
  status,
  failedAt: null,
  failures: 0,
  lastOutcome: null
})
const failedAs = (failures: number, ago: number): HandledState => ({
  status: 'failed',
  failedAt: NOW - ago,
  failures,
  lastOutcome: 'agent exited'
})
const verdicts = (i: DecideInput) => decideTick(i).map((d) => [d.key, d.verdict, d.reason])

describe('decideTick: scope, once_per and baseline', () => {
  it("applies the source's scope, then each match expression, naming the clause", () => {
    const def = testDefinition({
      items: {
        kind: 'merge_request',
        where: {},
        match: ['{mr.waiting_threads} > 0'],
        customFields: []
      }
    })
    const items = [
      item(1, { 'mr.waiting_threads': 2 }),
      item(2, { 'mr.waiting_threads': 0 }),
      item(3),
      item(4)
    ]
    const scope = new Map([
      ['mr:3', { verdict: 'out_of_scope' as const, reason: 'MR is closed' }],
      ['mr:4', { verdict: 'notdue' as const, reason: 'Head pipeline running' }]
    ])
    expect(verdicts(input(def, items, { scope }))).toEqual([
      ['mr:1', 'started', 'All checks pass'],
      ['mr:2', 'out_of_scope', 'Doesn\'t match "{mr.waiting_threads} > 0"'],
      ['mr:3', 'out_of_scope', 'MR is closed'],
      ['mr:4', 'notdue', 'Head pipeline running']
    ])
  })

  type HandledCase = [
    string,
    HandledState,
    { retry?: number | null; askFirst?: boolean; byHand?: boolean },
    string,
    string
  ]
  it.each<HandledCase>([
    ['handled and done', handledAs('done'), {}, 'notdue', 'Already handled 1'],
    // A seeded key (no run) or a run still going stays handled: only a failed run is retried.
    ['handled, seeded or still started', handledAs('started'), {}, 'notdue', 'Already handled 1'],
    [
      'failed past the retry limit',
      failedAs(3, 13 * HOUR),
      {},
      'notdue',
      'Gave up after 3 failures; Retry from Running'
    ],
    [
      'failed past the retry limit, by hand',
      failedAs(3, 13 * HOUR),
      { byHand: true },
      'started',
      'All checks pass'
    ],
    [
      'failed, in an ask-first job',
      failedAs(1, 13 * HOUR),
      { askFirst: true },
      'notdue',
      'Already handled 1'
    ],
    [
      'failed 13h ago, retry after 12h',
      failedAs(1, 13 * HOUR),
      { retry: 12 * HOUR },
      'started',
      'All checks pass'
    ],
    [
      'failed 1h ago, retry after 12h',
      failedAs(1, HOUR),
      { retry: 12 * HOUR },
      'held',
      'Retry 1 of 2 at 23:00. Last run failed: agent exited'
    ],
    [
      'failed 5 min ago, no retry_after_failure',
      failedAs(2, 5 * 60_000),
      {},
      'held',
      'Retry 2 of 2 at 12:05. Last run failed: agent exited'
    ]
  ])('once_per: %s', (_name, state, opts, verdict, reason) => {
    const def = testDefinition({
      oncePer: '{mr.iid}',
      retryAfterFailureMs: opts.retry ?? null,
      ...(opts.askFirst ? { start: 'ask_first' as const } : {})
    })
    const given = input(def, [item(1)], {
      handled: new Map([['1', state]]),
      byHand: opts.byHand ?? false
    })
    const [d] = decideTick(given)
    expect([d.verdict, d.reason]).toEqual([verdict, reason])
  })

  it('baselines an item it has never seen', () => {
    const def = testDefinition({ firstSeen: 'baseline' })
    expect(verdicts(input(def, [item(1), item(2)], { seenKeys: new Set(['mr:2']) }))).toEqual([
      ['mr:1', 'baselined', 'First time seen: recorded, not acted on'],
      ['mr:2', 'started', 'All checks pass']
    ])
  })

  it('skips an item a field script said is not due, after scope, once_per and first_seen', () => {
    const def = testDefinition({ oncePer: '{mr.iid}', firstSeen: 'baseline' })
    const notDue = new Map([
      ['mr:1', 'pipeline still running'],
      ['mr:2', 'not yet'],
      ['mr:3', 'not yet']
    ])
    const out = verdicts(
      input(def, [item(1), item(2), item(3), item(4)], {
        notDue,
        handled: new Map([['2', handledAs('done')]]),
        seenKeys: new Set(['mr:1', 'mr:2', 'mr:4'])
      })
    )
    expect(out).toEqual([
      ['mr:1', 'skipped', 'pipeline still running'],
      ['mr:2', 'notdue', 'Already handled 2'],
      ['mr:3', 'baselined', 'First time seen: recorded, not acted on'],
      ['mr:4', 'started', 'All checks pass']
    ])
  })

  it("lets a field script's not-due reason win over items.match on its null field", () => {
    const def = testDefinition({
      items: {
        kind: 'merge_request',
        where: {},
        match: ["{mr.stack} != 'frontend'"],
        customFields: []
      }
    })
    const notDue = new Map([['mr:1', 'pipeline still running']])
    expect(verdicts(input(def, [item(1, { 'mr.stack': null })], { notDue }))).toEqual([
      ['mr:1', 'skipped', 'pipeline still running']
    ])
  })

  it.each([
    ['a seen item whose source says first sight (history rewritten)', true, true, 'baselined'],
    ['an unseen item whose source says not first sight (recent work)', false, false, 'started']
  ])('lets the source own first sight: %s', (_name, seen, baseline, verdict) => {
    const def = testDefinition({ firstSeen: 'baseline' })
    const items = [item(1, { 'item.baseline': baseline })]
    const seenKeys = new Set(seen ? ['mr:1'] : [])
    expect(verdicts(input(def, items, { seenKeys })).map((v) => v[1])).toEqual([verdict])
  })

  it('runs a run-once automation every tick: no scope, once_per or baseline', () => {
    const def = testDefinition({
      items: null,
      firstSeen: 'baseline',
      workspace: { kind: 'main_checkout' }
    })
    const repo = {
      key: 'repo:web-platform',
      label: 'web-platform',
      fields: { 'repo.path': '/repo' }
    }
    const out = decideTick(
      input(def, [repo], {
        handled: new Map([['repo:web-platform', handledAs('done')]]),
        scope: new Map([['repo:web-platform', { verdict: 'out_of_scope' as const, reason: 'x' }]])
      })
    )
    expect([out[0].verdict, out[0].reason]).toEqual(['started', 'All checks pass'])
  })

  // Review Focus 3: with once_per a run-once automation runs once per key (once per local day).
  it('honours once_per on a run-once automation', () => {
    const def = testDefinition({
      items: null,
      oncePer: '{run.date}',
      workspace: { kind: 'main_checkout' }
    })
    const repo = {
      key: 'repo:web-platform',
      label: 'web-platform',
      fields: { 'run.date': '20261010' }
    }
    const handled = new Map([['20261010', handledAs('done')]])
    const [d] = decideTick(input(def, [repo], { handled }))
    expect([d.verdict, d.reason]).toEqual(['notdue', 'Already handled 20261010'])
  })
})

describe('decideTick: checks and the worktree rule', () => {
  it('stops at the first failing check, using precomputed script results', () => {
    const def = testDefinition({
      checks: [
        { kind: 'worktree_exists' },
        { kind: 'script', run: './gate.sh', timeoutMs: 1000 },
        { kind: 'worktree_idle' }
      ]
    })
    const scriptChecks = new Map([
      ['mr:1', new Map([[1, { ok: false, reason: 'Nothing to do' }]])],
      ['mr:2', new Map([[1, { ok: true, reason: 'Ready' }]])]
    ])
    const out = decideTick(
      input(def, [item(1), item(2, { 'worktree.busy': '' }), item(3, { 'worktree.path': null })], {
        scriptChecks
      })
    )
    expect(out.map((d) => [d.verdict, d.reason, d.checks.length])).toEqual([
      ['skipped', 'Nothing to do', 2],
      ['started', 'All checks pass', 3],
      ['skipped', 'No worktree for !3', 1]
    ])
  })

  // G2/B2: only an item's own worktree is exclusive. The main checkout is shared by design (01 hourly
  // must not block 02 and 07), and a new worktree is the run's own.
  it.each<[string, AutomationDefinition['workspace'], string, string]>([
    ["the item's worktree", { kind: 'item_worktree' }, '/wt/1', 'held'],
    ['the main checkout', { kind: 'main_checkout' }, '/repo', 'started'],
    [
      'a new worktree never collides',
      { kind: 'new_worktree', base: 'origin/dev', name: 'x', reuseExisting: false, setup: 'skip' },
      '/wt/1',
      'started'
    ]
  ])(
    "another automation's run is active in %s: the next run is %s",
    (_name, workspace, busy, verdict) => {
      const def = testDefinition({ workspace })
      const [d] = decideTick(input(def, [item(1)], { busyWorktrees: new Set([busy]) }))
      expect(d.verdict).toBe(verdict)
      if (verdict === 'held') {
        expect(d.hold).toEqual({
          code: 'worktree_busy',
          detail: `Another run is active in ${busy}`
        })
        expect(d.reason).toBe(`Another run is active in ${busy}`)
      }
    }
  )

  it.each<[string, AutomationDefinition['workspace'], string | null]>([
    ["the item's worktree", { kind: 'item_worktree' }, '/wt/1'],
    ['the main checkout: shared, so no exclusive path', { kind: 'main_checkout' }, null],
    [
      'a new worktree',
      { kind: 'new_worktree', base: 'origin/dev', name: 'x', reuseExisting: false, setup: 'run' },
      null
    ]
  ])('workspacePathOf: %s', (_name, workspace, path) => {
    expect(workspacePathOf(testDefinition({ workspace }), item(1).fields)).toBe(path)
  })

  it.each<[string, Partial<AutomationDefinition>, boolean]>([
    ['an item automation', {}, true],
    ['a run-once automation without once_per', { items: null }, false],
    ['a run-once automation with once_per', { items: null, oncePer: '{run.date}' }, true]
  ])('usesHandled: %s', (_name, over, expected) => {
    expect(usesHandled(testDefinition(over))).toBe(expected)
  })

  it('starts nothing twice in one tick: same once_per key, same worktree', () => {
    const def = testDefinition({ oncePer: '{mr.pipeline}', checks: EXISTS })
    const items = [
      item(1, { 'mr.pipeline': 9 }),
      item(2, { 'mr.pipeline': 9, 'worktree.path': '/wt/2' }),
      item(3, { 'mr.pipeline': 10, 'worktree.path': '/wt/1' })
    ]
    expect(verdicts(input(def, items))).toEqual([
      ['mr:1', 'started', 'All checks pass'],
      ['mr:2', 'notdue', 'Already handled 9'],
      ['mr:3', 'held', 'Another run starts in /wt/1 this tick']
    ])
  })
})

describe('decideTick: limits, order and ask_first', () => {
  it('holds past the per-tick limit', () => {
    const perTick = testDefinition({
      limits: { perTick: 1, atOnce: null, timeoutMs: null, order: 'listed' }
    })
    const out = decideTick(input(perTick, [item(1), item(2)]))
    expect(out.map((d) => [d.verdict, d.hold])).toEqual([
      ['started', undefined],
      ['held', { code: 'tick_limit', detail: 'Over the limit of 1 per tick' }]
    ])
  })

  it('at_once over the limit holds', () => {
    const atOnce = testDefinition({
      limits: { perTick: null, atOnce: 2, timeoutMs: null, order: 'listed' }
    })
    const [d] = decideTick(input(atOnce, [item(1)], { activeRuns: 2 }))
    expect([d.verdict, d.reason, d.hold]).toEqual([
      'held',
      'At most 2 at once',
      { code: 'job_limit', detail: 'At most 2 at once' }
    ])
  })

  it.each<[string, 'listed' | 'oldest_waiting_first' | 'priority', string[]]>([
    ['listed keeps the source order', 'listed', ['started', 'held', 'held']],
    ['oldest waiting first', 'oldest_waiting_first', ['held', 'started', 'held']],
    ['priority, lowest number first, unknown last', 'priority', ['held', 'held', 'started']]
  ])('gives the per-tick slot by order: %s', (_name, order, expected) => {
    const def = testDefinition({ limits: { perTick: 1, atOnce: null, timeoutMs: null, order } })
    const items = [
      item(1, {}, { waitingSince: 300, priority: null }),
      item(2, {}, { waitingSince: 100, priority: 3 }),
      item(3, {}, { waitingSince: null, priority: 1 })
    ]
    const out = decideTick(input(def, items))
    expect(out.map((d) => d.key)).toEqual(['mr:1', 'mr:2', 'mr:3'])
    expect(out.map((d) => d.verdict)).toEqual(expected)
  })

  it('asks first instead of starting: takes a per-tick slot but no worktree and no at_once slot', () => {
    const def = testDefinition({
      start: 'ask_first',
      askFirst: { title: 'Prepare a review of !{mr.iid}?', context: '', options: [] },
      limits: { perTick: 2, atOnce: 1, timeoutMs: null, order: 'listed' }
    })
    const items = [item(1), item(2, { 'worktree.path': '/wt/1' }), item(3)]
    expect(verdicts(input(def, items))).toEqual([
      ['mr:1', 'asked', 'Asks first: Prepare a review of !1?'],
      ['mr:2', 'asked', 'Asks first: Prepare a review of !2?'],
      ['mr:3', 'held', 'Over the limit of 2 per tick']
    ])
  })
})

describe("decideTick: the runner holds what can't start now", () => {
  const QUOTA = { kind: 'quota' as const, agent: 'claude' as const, weekly: 90, session: 95 }

  // 03 declares worktree: clean before mr: not_merged; an ineligible item must not wait in line.
  it('an eligibility failure after a runtime failure skips', () => {
    const def = testDefinition({
      checks: [{ kind: 'worktree_clean' }, { kind: 'mr', rule: 'not_merged' }]
    })
    const fields = {
      'worktree.git_operation': null,
      'worktree.dirty_count': 2,
      'mr.finished_block': 'Merged'
    }
    const [d] = decideTick(input(def, [item(1, fields)]))
    expect([d.verdict, d.reason, d.hold]).toEqual(['skipped', 'Merged', undefined])
  })

  it('a runtime failure holds', () => {
    const def = testDefinition({ checks: [QUOTA] })
    const items = [
      item(1, { 'quota.claude.weekly_pct': 99 }, { waitingSince: 500, priority: null }),
      item(2, { 'quota.claude.weekly_pct': 99 })
    ]
    const out = decideTick(input(def, items))
    const detail = 'Claude is at 99% of its weekly limit (stops at 90%)'
    expect(out.map((d) => [d.verdict, d.reason, d.hold, d.dueAt])).toEqual([
      ['held', detail, { code: 'quota', detail }, 500],
      ['held', detail, { code: 'quota', detail }, NOW]
    ])
  })

  it.each<[string, Partial<AutomationDefinition>, ItemFields, string, string | undefined]>([
    [
      'a claude job at weekly 99',
      {},
      { 'quota.claude.weekly_pct': 99 },
      'held',
      'claude weekly limit at 99% (jobs stop at 90%)'
    ],
    [
      'a claude job at session 96',
      {},
      { 'quota.claude.session_pct': 96 },
      'held',
      'claude session limit at 96% (jobs stop at 95%)'
    ],
    [
      'a codex step at weekly 91',
      { steps: [testStep({ agent: 'shell' }), testStep({ agent: 'codex' })] },
      { 'quota.codex.weekly_pct': 91 },
      'held',
      'codex weekly limit at 91% (jobs stop at 90%)'
    ],
    [
      'a shell-only job',
      { steps: [testStep({ agent: 'shell' })] },
      { 'quota.claude.weekly_pct': 99 },
      'started',
      undefined
    ],
    ['an unreadable quota', {}, { 'quota.claude.weekly_pct': null }, 'started', undefined],
    [
      'an ask_first job: asking costs nothing',
      { start: 'ask_first' },
      { 'quota.claude.weekly_pct': 99 },
      'asked',
      undefined
    ]
  ])('implicit quota: %s', (_name, over, fields, verdict, detail) => {
    const [d] = decideTick(input(testDefinition(over), [item(1, fields)]))
    expect([d.verdict, d.hold]).toEqual([verdict, detail && { code: 'quota', detail }])
  })

  it.each<[string, AutomationDefinition['checks'], number, string]>([
    ['declared 80, at 85', [{ ...QUOTA, weekly: 80 }], 85, 'held'],
    ['declared 95, at 92', [{ ...QUOTA, weekly: 95 }], 92, 'started'],
    ['implicit only, at 85', [], 85, 'started']
  ])(
    'a declared quota for an agent replaces the implicit one: %s',
    (_name, checks, weekly, verdict) => {
      const def = testDefinition({ checks })
      const [d] = decideTick(input(def, [item(1, { 'quota.claude.weekly_pct': weekly })]))
      expect(d.verdict).toBe(verdict)
    }
  )

  it("a held item doesn't use a per-tick slot", () => {
    const def = testDefinition({
      checks: [{ kind: 'worktree_idle' }],
      limits: { perTick: 1, atOnce: null, timeoutMs: null, order: 'listed' }
    })
    const items = [
      item(1, { 'worktree.busy': 'someone is typing in Fix' }),
      item(2, { 'worktree.busy': '' })
    ]
    const out = decideTick(input(def, items))
    expect(out.map((d) => [d.key, d.verdict, d.hold?.code])).toEqual([
      ['mr:1', 'held', 'worktree_busy'],
      ['mr:2', 'started', undefined]
    ])
  })

  // Job 14's cards without a worktree work in the repo's main checkout, which is shared.
  it.each(['/repo', '/repo/'])(
    "two items in the main checkout don't collide (listed as %s)",
    (path) => {
      const def = testDefinition({ workspace: { kind: 'item_worktree' } })
      const items = [item(1, { 'worktree.path': path }), item(2, { 'worktree.path': path })]
      expect(decideTick(input(def, items)).map((d) => d.verdict)).toEqual(['started', 'started'])
    }
  )
})
