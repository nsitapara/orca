import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ItemDecision } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import { PilotStore } from '../store/store'
import { runCapacity } from './run-capacity'

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

const item = (key: string) => ({ key, label: `!${key}` })

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
    expect(capacity.admit(a, item('first'), false)).toEqual({ start: true, byHand: false })
    running('a')
    store.runs.update('run-2', { status: 'done', finishedAt: 60 })
    // Run now queued it, so its run is still recorded as by hand.
    expect(capacity.admit(b, item('second'), false)).toEqual({ start: true, byHand: true })
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
})

describe('runCapacity.settle', () => {
  it("drops the automation's queued items its tick didn't leave waiting", () => {
    const a = agentJob('a')
    const b = agentJob('b')
    const { store, capacity, running } = setup([a, b], 1)
    running('a')
    for (const key of ['x', 'y']) {
      capacity.admit(a, item(key), false)
    }
    capacity.admit(b, item('z'), false)
    const decision = (key: string, verdict: ItemDecision['verdict']): ItemDecision => ({
      key,
      label: key,
      onceKey: key,
      fields: {},
      checks: [],
      verdict,
      reason: ''
    })
    capacity.settle(a, [decision('x', 'notdue'), decision('y', 'queued')])
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(['y', 'z'])
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
    expect(capacity.toTick([a, b, c])).toEqual([])
    store.runs.update('run-1', { status: 'done', finishedAt: 9 })
    store.runs.update('run-2', { status: 'done', finishedAt: 9 })
    expect(capacity.toTick([a, b, c])).toEqual(['b'])
    store.capacity.setRunLimit(null, 1)
    expect(capacity.toTick([a, b, c])).toEqual(['b', 'c'])
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
    expect(capacity.toTick([off])).toEqual(['off'])
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(['by-hand'])
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
