import { describe, expect, it } from 'vitest'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import { EMPTY_PEOPLE, parsePeopleYaml } from '../../shared/people'
import { runCapacity } from '../capacity/run-capacity'
import { fakeFieldDeps, testItem } from '../fields/__fixtures__/field-deps'
import { PilotStore } from '../store/store'
import { runTick, type TickDeps, type TickOptions } from './tick-runner'

// Not merged is eligibility; an uncommitted file fails Clean, a runtime gate, so the item is held.
const def = testDefinition({
  id: 'fix-failed-ci',
  oncePer: '{mr.iid}',
  checks: [
    { kind: 'mr', rule: 'not_merged' },
    { kind: 'worktree_exists' },
    { kind: 'worktree_clean' }
  ]
})
const t1 = Date.UTC(2026, 9, 10, 19, 10)
const t2 = t1 + 60_000

type Moment = { finished: string; waitingSince: number | null }

// One MR whose worktree has an uncommitted file; each tick reads `moment` as it is then.
function holding(moment: Moment) {
  const store = PilotStore.open(':memory:')
  let clock = t1
  const deps: TickDeps = {
    store,
    now: () => clock,
    resolveRepo: async () => ({ name: 'r', id: 'r', path: '/repo', base: 'origin/dev' }),
    sources: {
      list: async () => ({
        items: [
          testItem({
            key: 'mr:1',
            label: '!1',
            fields: { 'mr.iid': 1, 'mr.branch': 'web-1', 'mr.finished_block': moment.finished },
            worktreeHint: { branch: 'web-1' },
            sortKeys: { waitingSince: moment.waitingSince, priority: null }
          })
        ],
        warnings: []
      }),
      scope: () => null
    },
    fields: fakeFieldDeps({
      listWorktrees: async () => [
        { id: 'r::/wt/1', path: '/wt/1', branch: 'web-1', head: 'h', linkedLinearIssue: null }
      ],
      gitStatus: async () => ({ dirty: 1, untracked: 0 })
    }),
    ask: {
      store,
      now: () => 0,
      inbox: { store, now: () => 0, definitions: () => [], people: () => EMPTY_PEOPLE }
    },
    launch: async () => ({ terminalHandle: 't', paneKey: 'p' }),
    capacity: runCapacity({ store, definitions: () => [def], now: () => clock })
  }
  const tick = (at: number, recheck = false) => {
    clock = at
    return runTick(def, EMPTY_PEOPLE, deps, { dryRun: false, recheck })
  }
  return { store, tick }
}

describe("runTick holding an item in the runner's line", () => {
  it('keeps the held row, then drops it once the item is no longer eligible', async () => {
    const moment: Moment = { finished: '', waitingSince: null }
    const { store, tick } = holding(moment)
    const first = await tick(t1)
    expect(first.decisions.map((x) => [x.verdict, x.reason])).toEqual([
      ['held', '1 uncommitted file']
    ])
    expect(store.capacity.queued().map((q) => [q.itemKey, q.holdCode])).toEqual([
      ['mr:1', 'in_flight']
    ])
    moment.finished = 'Merged'
    const second = await tick(t2)
    expect(second.decisions.map((x) => x.verdict)).toEqual(['skipped'])
    expect(store.capacity.queued()).toEqual([])
  })

  it('keeps its due time when a later tick holds it again, and records the re-check', async () => {
    const moment: Moment = { finished: '', waitingSince: 50 }
    const { store, tick } = holding(moment)
    await tick(t1)
    // Its due time would now be when it was first seen (t1); the line keeps the earlier one.
    moment.waitingSince = null
    const second = await tick(t2)
    expect(second.decisions.map((x) => x.verdict)).toEqual(['held'])
    expect(store.capacity.queued().map((q) => [q.dueAt, q.checkedAt])).toEqual([[50, t2]])
  })

  it('records a re-check tick, so Activity leaves it out though it skipped the item', async () => {
    const { store, tick } = holding({ finished: 'Merged', waitingSince: null })
    const scheduled = await tick(t1)
    await tick(t2, true)
    expect(store.listTicks(def.id, 10, true).map((t) => t.id)).toEqual([scheduled.tickId])
  })
})

const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish }\n')

// Clean MRs, launched by `launch`; the give-up card goes to the tick's inbox.
function launching(launch: TickDeps['launch'], iids: readonly number[] = [1]) {
  const store = PilotStore.open(':memory:')
  if (!people.ok) {
    throw new Error('setup')
  }
  const directory = people.directory
  let clock = t1
  const deps: TickDeps = {
    store,
    now: () => clock,
    resolveRepo: async () => ({ name: 'r', id: 'r', path: '/repo', base: 'origin/dev' }),
    sources: {
      list: async () => ({
        items: iids.map((n) =>
          testItem({
            key: `mr:${n}`,
            label: `!${n}`,
            fields: { 'mr.iid': n, 'mr.branch': `web-${n}`, 'mr.finished_block': '' },
            worktreeHint: { branch: `web-${n}` }
          })
        ),
        warnings: []
      }),
      scope: () => null
    },
    fields: fakeFieldDeps({
      listWorktrees: async () =>
        iids.map((n) => ({
          id: `r::/wt/${n}`,
          path: `/wt/${n}`,
          branch: `web-${n}`,
          head: 'h',
          linkedLinearIssue: null
        }))
    }),
    ask: {
      store,
      now: () => clock,
      inbox: { store, now: () => clock, definitions: () => [def], people: () => directory }
    },
    launch
  }
  const tick = (at: number, opts: Omit<TickOptions, 'dryRun'> = {}) => {
    clock = at
    return runTick(def, directory, deps, { dryRun: false, ...opts })
  }
  return { store, deps, tick }
}

// Three failed runs on a key: past the default limit of 2.
function giveUp(store: PilotStore, onceKey: string): void {
  for (const n of [1, 2, 3]) {
    store.markHandled(def.id, onceKey, `old-${onceKey}-${n}`, t1)
    store.setHandledStatus(def.id, `old-${onceKey}-${n}`, 'failed', t1)
  }
}

const failing = async (): Promise<never> => {
  throw new Error('worktree is gone')
}

describe('runTick counting a failed launch', () => {
  it('leaves the key failed with one failure, not freed, so the runner retries it', async () => {
    const { store, deps, tick } = launching(failing)
    deps.capacity = runCapacity({ store, definitions: () => [def], now: () => deps.now() })
    await tick(t1)
    expect(store.handledRows(def.id)).toMatchObject([
      { onceKey: '1', status: 'failed', failedAt: t1, failures: 1 }
    ])
    const again = await tick(t2)
    expect(again.decisions.map((x) => [x.verdict, x.hold?.code])).toEqual([['held', 'retry']])
    // The line re-checks it when its 10-minute wait ends.
    expect(store.capacity.queued().map((q) => [q.holdCode, q.recheckAt])).toEqual([
      ['retry', t1 + 600_000]
    ])
    expect(store.inbox.list({ automationId: def.id })).toEqual([])
  })

  it('gives up past the retry limit with one flagged card, and Run now still starts it', async () => {
    const { store, tick } = launching(failing)
    store.capacity.setRetryLimit(0, t1)
    await tick(t1)
    expect(
      store.inbox.list({ automationId: def.id }).map((i) => [i.type, i.itemKey, i.title, i.context])
    ).toEqual([
      [
        'flagged',
        'mr:1',
        'Auto failed 1 time: !1',
        "Couldn't start: worktree is gone. Retry it from Running."
      ]
    ])
    const later = await tick(t2)
    expect(later.decisions.map((x) => [x.verdict, x.reason])).toEqual([
      ['notdue', 'Gave up after 1 failure; Run now or Retry from Running starts it again']
    ])
    const byHand = await tick(t2 + 60_000, { byHand: true })
    expect(byHand.decisions.map((x) => x.verdict)).toEqual(['started'])
    expect(store.handledRows(def.id)[0].failures).toBe(2)
    expect(store.inbox.list({ automationId: def.id })).toHaveLength(1)
  })
})

describe('runTick starting a given-up key by hand', () => {
  const started = async () => ({ terminalHandle: 't', paneKey: 'p' })

  it("keeps Run now's given-up key in the line through a re-check while it waits for a slot", async () => {
    const { store, deps, tick } = launching(started)
    deps.capacity = runCapacity({ store, definitions: () => [def], now: () => deps.now() })
    giveUp(store, '1')
    store.capacity.setRunLimit(1, t1)
    store.runs.create({
      id: 'busy',
      automationId: def.id,
      tickId: null,
      itemKey: 'mr:9',
      itemLabel: '!9',
      worktreePath: '/wt/9',
      startedAt: t1
    })
    const runNow = await tick(t2, { byHand: true })
    expect(runNow.decisions.map((x) => x.verdict)).toEqual(['queued'])
    const recheck = await tick(t2 + 60_000, { recheck: true })
    expect(recheck.decisions.map((x) => x.verdict)).toEqual(['queued'])
    expect(store.capacity.queued().map((q) => [q.itemKey, q.byHand])).toEqual([['mr:1', true]])
  })

  it("starts only Retry's key of a job with two given-up keys", async () => {
    const { store, tick } = launching(started, [1, 2])
    giveUp(store, '1')
    giveUp(store, '2')
    const retried = await tick(t2, { byHandKeys: new Set(['1']) })
    expect(retried.decisions.map((x) => [x.key, x.verdict])).toEqual([
      ['mr:1', 'started'],
      ['mr:2', 'notdue']
    ])
    // Activity shows you started it, as Run now's runs.
    expect(store.runs.forTick(retried.tickId).map((r) => [r.itemKey, r.trigger])).toEqual([
      ['mr:1', 'manual']
    ])
  })
})

type Lined = { listed: number[]; dirty: Set<number>; statusReads: string[] }

// MRs whose worktrees are clean unless `dirty`; each tick lists `listed` as it is then.
function lining(lineDef: AutomationDefinition) {
  const store = PilotStore.open(':memory:')
  const state: Lined = { listed: [1], dirty: new Set([1]), statusReads: [] }
  let clock = t1
  const deps: TickDeps = {
    store,
    now: () => clock,
    resolveRepo: async () => ({ name: 'r', id: 'r', path: '/repo', base: 'origin/dev' }),
    sources: {
      list: async () => ({
        items: state.listed.map((n) =>
          testItem({
            key: `mr:${n}`,
            label: `!${n}`,
            fields: { 'mr.iid': n, 'mr.branch': `web-${n}`, 'mr.finished_block': '' },
            worktreeHint: { branch: `web-${n}` }
          })
        ),
        warnings: []
      }),
      scope: () => null
    },
    fields: fakeFieldDeps({
      listWorktrees: async () =>
        state.listed.map((n) => ({
          id: `r::/wt/${n}`,
          path: `/wt/${n}`,
          branch: `web-${n}`,
          head: 'h',
          linkedLinearIssue: null
        })),
      gitStatus: async (path) => {
        state.statusReads.push(path)
        return { dirty: state.dirty.has(Number(path.split('/').pop())) ? 1 : 0, untracked: 0 }
      }
    }),
    ask: {
      store,
      now: () => clock,
      inbox: { store, now: () => clock, definitions: () => [lineDef], people: () => EMPTY_PEOPLE }
    },
    launch: async () => ({ terminalHandle: 't', paneKey: 'p' }),
    capacity: runCapacity({ store, definitions: () => [lineDef], now: () => clock })
  }
  const tick = (at: number, opts: Omit<TickOptions, 'dryRun'> = {}) => {
    clock = at
    state.statusReads = []
    return runTick(lineDef, EMPTY_PEOPLE, deps, { dryRun: false, ...opts })
  }
  return { store, state, tick }
}

const cleanJob = (over: Partial<AutomationDefinition> = {}) =>
  testDefinition({
    id: 'fix-failed-ci',
    schedule: '10 * * * *',
    oncePer: '{mr.iid}',
    checks: [{ kind: 'mr', rule: 'not_merged' }, { kind: 'worktree_clean' }],
    ...over
  })

const WAITS = "Waits for its job's next tick"

describe("a re-check tick acts on its job's line only", () => {
  it('starts the line item and leaves the other due items, unread and unrecorded, for the next tick', async () => {
    const { store, state, tick } = lining(cleanJob())
    await tick(t1)
    state.listed = [1, 2, 3]
    state.dirty = new Set()
    const recheck = await tick(t2, { recheck: true })
    expect(recheck.decisions.map((x) => [x.key, x.verdict, x.reason])).toEqual([
      ['mr:1', 'started', 'All checks pass'],
      ['mr:2', 'notdue', WAITS],
      ['mr:3', 'notdue', WAITS]
    ])
    expect(store.runs.forTick(recheck.tickId).map((r) => r.itemKey)).toEqual(['mr:1'])
    // No facts are read for an item the re-check leaves, and only the line item's decision is kept.
    expect(state.statusReads).toEqual(['/wt/1'])
    expect(store.tickItems(recheck.tickId).map((i) => i.itemKey)).toEqual(['mr:1'])
    expect(store.seenKeys(cleanJob().id)).toEqual(new Set(['mr:1']))
  })

  it("still holds the line item, and a per-tick overflow keeps its row for the job's own tick", async () => {
    const { store, state, tick } = lining(
      cleanJob({ limits: { ...cleanJob().limits, perTick: 1 } })
    )
    state.listed = [1, 2, 3]
    state.dirty = new Set([1])
    await tick(t1)
    expect(store.capacity.queued().map((q) => [q.itemKey, q.holdCode])).toEqual([
      ['mr:1', 'in_flight'],
      ['mr:3', 'tick_limit']
    ])
    const recheck = await tick(t2, { recheck: true })
    expect(recheck.decisions.map((x) => [x.key, x.verdict])).toEqual([
      ['mr:1', 'held'],
      ['mr:2', 'notdue'],
      ['mr:3', 'notdue']
    ])
    expect(store.capacity.queued().map((q) => [q.itemKey, q.holdCode])).toEqual([
      ['mr:1', 'in_flight'],
      ['mr:3', 'tick_limit']
    ])
  })

  it('makes no once key for an item outside the line when once_per names the tick (job 06)', async () => {
    const { store, state, tick } = lining(cleanJob({ oncePer: '{mr.iid}:{run.tick}' }))
    await tick(t1)
    state.listed = [1, 2]
    await tick(t2, { recheck: true })
    expect(store.handledKeys(cleanJob().id)).toEqual(new Set())
  })

  it('decides every item when it lands on the due slot (not a re-check)', async () => {
    const { state, tick } = lining(cleanJob())
    await tick(t1)
    state.listed = [1, 2]
    const due = await tick(t2)
    expect(due.decisions.map((x) => [x.key, x.verdict])).toEqual([
      ['mr:1', 'held'],
      ['mr:2', 'started']
    ])
  })
})

describe('a Retry tick acts on its key and the line only', () => {
  it('starts only the retried ticket of a manual job (M01)', async () => {
    const m01 = cleanJob({ id: 'linear-todo', schedule: 'manual', enabled: false, checks: [] })
    const { store, state, tick } = lining(m01)
    state.listed = [1, 2, 3]
    state.dirty = new Set()
    store.runs.create({
      id: 'old',
      automationId: m01.id,
      tickId: null,
      itemKey: 'mr:2',
      itemLabel: '!2',
      worktreePath: '/wt/2',
      startedAt: t1
    })
    store.runs.update('old', { status: 'failed', finishedAt: t1 })
    store.markHandled(m01.id, '2', 'old', t1)
    store.setHandledStatus(m01.id, 'old', 'failed', t1)
    // As pilot.capacity.retry: the freed key's item is ticked with it.
    const itemKey = store.resetFailures(m01.id, '2')
    expect(itemKey).toBe('mr:2')
    const retried = await tick(t2, { byHandKeys: new Set(['2', 'mr:2']) })
    expect(retried.decisions.map((x) => [x.key, x.verdict])).toEqual([
      ['mr:2', 'started'],
      ['mr:1', 'notdue'],
      ['mr:3', 'notdue']
    ])
    expect(store.runs.forTick(retried.tickId).map((r) => [r.itemKey, r.trigger])).toEqual([
      ['mr:2', 'manual']
    ])
  })
})
