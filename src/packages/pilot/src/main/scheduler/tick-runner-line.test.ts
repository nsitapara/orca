import { describe, expect, it } from 'vitest'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import { EMPTY_PEOPLE, parsePeopleYaml } from '../../shared/people'
import { runCapacity } from '../capacity/run-capacity'
import { fakeFieldDeps, testItem } from '../fields/__fixtures__/field-deps'
import { PilotStore } from '../store/store'
import { runTick, type TickDeps } from './tick-runner'

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

// One clean MR, launched by `launch`; the give-up card goes to the tick's inbox.
function launching(launch: TickDeps['launch']) {
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
        items: [
          testItem({
            key: 'mr:1',
            label: '!1',
            fields: { 'mr.iid': 1, 'mr.branch': 'web-1', 'mr.finished_block': '' },
            worktreeHint: { branch: 'web-1' }
          })
        ],
        warnings: []
      }),
      scope: () => null
    },
    fields: fakeFieldDeps({
      listWorktrees: async () => [
        { id: 'r::/wt/1', path: '/wt/1', branch: 'web-1', head: 'h', linkedLinearIssue: null }
      ]
    }),
    ask: {
      store,
      now: () => clock,
      inbox: { store, now: () => clock, definitions: () => [def], people: () => directory }
    },
    launch
  }
  const tick = (at: number, byHand = false) => {
    clock = at
    return runTick(def, directory, deps, { dryRun: false, byHand })
  }
  return { store, tick }
}

const failing = async (): Promise<never> => {
  throw new Error('worktree is gone')
}

describe('runTick counting a failed launch', () => {
  it('leaves the key failed with one failure, not freed, so the runner retries it', async () => {
    const { store, tick } = launching(failing)
    await tick(t1)
    expect(store.handledRows(def.id)).toMatchObject([
      { onceKey: '1', status: 'failed', failedAt: t1, failures: 1 }
    ])
    const again = await tick(t2)
    expect(again.decisions.map((x) => [x.verdict, x.hold?.code])).toEqual([['held', 'retry']])
    expect(store.inbox.list({ automationId: def.id })).toEqual([])
  })

  it('gives up past the retry limit with one flagged card, and Run now still starts it', async () => {
    const { store, tick } = launching(failing)
    store.capacity.setRetryLimit(0, t1)
    await tick(t1)
    // A card keeps its context on one line, so the blank line before the hint reads as a space.
    expect(
      store.inbox.list({ automationId: def.id }).map((i) => [i.type, i.itemKey, i.title, i.context])
    ).toEqual([
      [
        'flagged',
        'mr:1',
        'Auto failed 1 time: !1',
        "Couldn't start: worktree is gone Retry it from Running."
      ]
    ])
    const later = await tick(t2)
    expect(later.decisions.map((x) => [x.verdict, x.reason])).toEqual([
      ['notdue', 'Gave up after 1 failure; Retry from Running']
    ])
    const byHand = await tick(t2 + 60_000, true)
    expect(byHand.decisions.map((x) => x.verdict)).toEqual(['started'])
    expect(store.handledRows(def.id)[0].failures).toBe(2)
    expect(store.inbox.list({ automationId: def.id })).toHaveLength(1)
  })
})
