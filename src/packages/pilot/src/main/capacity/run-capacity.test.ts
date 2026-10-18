import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HoldReason, ItemDecision } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import { PilotStore } from '../store/store'
import { recheckAfterMs, runCapacity } from './run-capacity'

const agentJob = (id: string, over: Partial<AutomationDefinition> = {}) =>
  testDefinition({ id, ...over })
const shellJob = (id: string) =>
  testDefinition({ id, steps: [testStep({ agent: 'shell', run: 'true', prompt: null })] })

function setup(defs: AutomationDefinition[], limit: number | null) {
  const store = PilotStore.open(
    join(mkdtempSync(join(tmpdir(), 'pilot-run-capacity-')), 'db.sqlite')
  )
  store.capacity.setRunLimit(limit, 0)
  let clock = 100
  const capacity = runCapacity({ store, definitions: () => defs, now: () => (clock += 1) })
  let n = 0
  const running = (automationId: string) =>
    store.runs.create({
      id: `run-${(n += 1)}`,
      automationId,
      tickId: null,
      itemKey: `k${n}`,
      itemLabel: `k${n}`,
      worktreePath: null,
      startedAt: n
    })
  return { store, capacity, running }
}

const item = (key: string, dueAt = 0) => ({ key, label: `!${key}`, dueAt })
const everywhere = () => true

// A row already in line, as an earlier tick left it.
function inLine(
  store: PilotStore,
  def: AutomationDefinition,
  key: string,
  over: { holdCode: HoldReason; dueAt: number; checkedAt?: number }
) {
  store.capacity.enqueue({
    automationId: def.id,
    itemKey: key,
    itemLabel: key,
    queuedAt: over.dueAt,
    byHand: false,
    holdDetail: 'earlier',
    checkedAt: over.dueAt,
    ...over
  })
}

describe('runCapacity.admit', () => {
  it.each([
    ['no limit', null, 5, true],
    ['a free slot', 2, 1, true],
    ['every slot taken', 2, 2, false]
  ])('with %s, starts: %s', (_name, limit, runningRuns, starts) => {
    const a = agentJob('a')
    const { capacity, running } = setup([a], limit)
    for (let i = 0; i < runningRuns; i++) {
      running('a')
    }
    expect(capacity.admit(a, item('x'), false).start).toBe(starts)
  })

  it('never makes a shell-only job wait, and its runs hold no slot', () => {
    const a = agentJob('a')
    const pull = shellJob('pull')
    const { capacity, running } = setup([a, pull], 1)
    running('pull')
    running('pull')
    expect(capacity.admit(a, item('x'), false).start).toBe(true)
    running('a')
    expect(capacity.admit(pull, item('y'), false).start).toBe(true)
  })

  it('queues a waiting item in line, then starts the oldest first when a slot frees', () => {
    const a = agentJob('a')
    const b = agentJob('b')
    const { store, capacity, running } = setup([a, b], 1)
    running('a')
    expect(capacity.admit(a, item('first'), false)).toEqual({
      start: false,
      reason: 'Waiting for a slot: 1 of 1 running'
    })
    expect(capacity.admit(b, item('second'), true)).toEqual({
      start: false,
      reason: 'Waiting for a slot: 1 of 1 running, 1 ahead'
    })
    store.runs.update('run-1', { status: 'done', finishedAt: 50 })
    // The newer item can't take the slot the older one is first in line for.
    expect(capacity.admit(b, item('second'), true).start).toBe(false)
    expect(capacity.admit(a, item('first'), false)).toEqual({
      start: true,
      byHand: false,
      queuedAt: 101
    })
    running('a')
    store.runs.update('run-2', { status: 'done', finishedAt: 60 })
    // Run now queued it, so its run is still recorded as by hand.
    expect(capacity.admit(b, item('second'), false)).toEqual({
      start: true,
      byHand: true,
      queuedAt: 102
    })
    expect(store.capacity.queued()).toEqual([])
  })

  it('keeps a requeued item in its place', () => {
    const a = agentJob('a')
    const { store, capacity, running } = setup([a], 1)
    running('a')
    capacity.admit(a, item('x'), false)
    capacity.admit(a, item('y'), false)
    capacity.admit(a, item('x'), false)
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(['x', 'y'])
  })

  it.each<[string, HoldReason, number, string | null]>([
    ['a held row due earlier', 'quota', 1, null],
    [
      'a slot-waiting row due earlier',
      'capacity',
      1,
      'Waiting for a slot: 0 of 1 running, 1 ahead'
    ],
    ['a slot-waiting row due later', 'capacity', 3, null]
  ])('with %s in line, waits: %s', (_name, holdCode, dueAt, waits) => {
    const a = agentJob('a')
    const b = agentJob('b')
    const { store, capacity } = setup([a, b], 1)
    inLine(store, a, 'x', { holdCode, dueAt })
    const admission = capacity.admit(b, item('y', 2), false)
    expect(admission.start ? null : admission.reason).toBe(waits)
  })
})

describe('runCapacity.hold', () => {
  it('writes the held row whatever the run limit', () => {
    const a = agentJob('a')
    const { store, capacity } = setup([a], null)
    capacity.hold(
      a,
      item('x', 5),
      { code: 'worktree_busy', detail: 'Another run is active in /wt' },
      true
    )
    expect(
      store.capacity.queued().map((q) => [q.itemKey, q.dueAt, q.holdCode, q.holdDetail, q.byHand])
    ).toEqual([['x', 5, 'worktree_busy', 'Another run is active in /wt', true]])
  })
})

describe('runCapacity.settle', () => {
  it("drops the automation's queued and held items its tick didn't leave waiting", () => {
    const a = agentJob('a')
    const b = agentJob('b')
    const { store, capacity, running } = setup([a, b], 1)
    running('a')
    for (const key of ['x', 'y']) {
      capacity.admit(a, item(key), false)
    }
    capacity.admit(b, item('z'), false)
    capacity.hold(a, item('h'), { code: 'quota', detail: 'over quota' }, false)
    const decision = (key: string, verdict: ItemDecision['verdict']): ItemDecision => ({
      key,
      label: key,
      onceKey: key,
      fields: {},
      checks: [],
      verdict,
      reason: ''
    })
    capacity.settle(a, [decision('x', 'notdue'), decision('y', 'queued'), decision('h', 'held')])
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(['y', 'z', 'h'])
  })
})

describe('runCapacity.toTick', () => {
  it('names the automations of the oldest items that fit the free slots, each once', () => {
    const [a, b, c] = ['a', 'b', 'c'].map((id) => agentJob(id))
    const { store, capacity, running } = setup([a, b, c], 3)
    for (let i = 0; i < 3; i++) {
      running('a')
    }
    for (const [def, key] of [
      [b, 'b1'],
      [b, 'b2'],
      [c, 'c1']
    ] as const) {
      capacity.admit(def, item(key), false)
    }
    expect(capacity.toTick([a, b, c], everywhere, 0)).toEqual([])
    store.runs.update('run-1', { status: 'done', finishedAt: 9 })
    store.runs.update('run-2', { status: 'done', finishedAt: 9 })
    expect(capacity.toTick([a, b, c], everywhere, 0)).toEqual(['b'])
    store.capacity.setRunLimit(null, 1)
    expect(capacity.toTick([a, b, c], everywhere, 0)).toEqual(['b', 'c'])
  })

  it('drops the items of a job that is gone or turned off, unless Run now queued them', () => {
    const a = agentJob('a')
    const off = agentJob('off', { enabled: false })
    const { store, capacity, running } = setup([a, off], 1)
    running('a')
    capacity.admit(a, item('gone'), false)
    capacity.admit(off, item('scheduled'), false)
    capacity.admit(off, item('by-hand'), true)
    store.capacity.setRunLimit(null, 1)
    expect(capacity.toTick([off], everywhere, 0)).toEqual(['off'])
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(['by-hand'])
  })

  it('re-checks a held row once its interval is over, and never spends a free slot on it', () => {
    const [quota, busy, slot] = ['quota', 'busy', 'slot'].map((id) => agentJob(id))
    const { store, capacity } = setup([quota, busy, slot], 1)
    const now = 1_000_000
    inLine(store, quota, 'x', { holdCode: 'quota', dueAt: 1, checkedAt: now - 100_000 })
    inLine(store, busy, 'z', { holdCode: 'worktree_busy', dueAt: 2, checkedAt: now - 61_000 })
    inLine(store, slot, 'w', { holdCode: 'capacity', dueAt: 3 })
    expect(capacity.toTick([quota, busy, slot], everywhere, now)).toEqual(['busy', 'slot'])
  })
})

describe('recheckAfterMs', () => {
  it.each<[HoldReason, number]>([
    ['quota', 300_000],
    ['window', 300_000],
    ['worktree_busy', 60_000],
    ['job_limit', 60_000]
  ])('re-checks a %s hold after %i ms', (code, ms) => {
    expect(recheckAfterMs(code)).toBe(ms)
  })
})

describe('runCapacity.toTick for a job pinned to another machine', () => {
  const ticksHere = (def: AutomationDefinition) => def.runsOn === null
  it.each([
    ['drops its scheduled item, so it never ticks here', [false], [], []],
    ["keeps Run now's item, so it still ticks here", [false, true], ['there'], ['by-hand']]
  ])('%s', (_name, byHands, ticks, left) => {
    const there = agentJob('there', { runsOn: 'Linux box' })
    const { store, capacity, running } = setup([there], 1)
    running('there')
    for (const byHand of byHands) {
      capacity.admit(there, item(byHand ? 'by-hand' : 'scheduled'), byHand)
    }
    store.capacity.setRunLimit(null, 1)
    expect(capacity.toTick([there], ticksHere, 0)).toEqual(ticks)
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(left)
  })
})

describe('runCapacity.hasFreeSlot', () => {
  it('lets an answer run go ahead of the queue whenever a slot is free', () => {
    const a = agentJob('a')
    const { capacity, running } = setup([a], 2)
    running('a')
    capacity.admit(a, item('waiting'), false)
    expect(capacity.hasFreeSlot(a)).toBe(true)
    running('a')
    expect(capacity.hasFreeSlot(a)).toBe(false)
    expect(capacity.hasFreeSlot(shellJob('pull'))).toBe(true)
  })
})
