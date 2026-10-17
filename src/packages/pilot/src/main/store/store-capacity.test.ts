import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'
import { RECENT_RUNS_FOR_PEAK } from './store-capacity'

function open(): PilotStore {
  return PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-capacity-')), 'db.sqlite'))
}

function addRun(store: PilotStore, id: string, automationId: string, startedAt: number): void {
  store.runs.create({
    id,
    automationId,
    tickId: null,
    itemKey: id,
    itemLabel: id,
    worktreePath: null,
    startedAt
  })
}

const item = (automationId: string, itemKey: string, queuedAt: number, byHand = false) => ({
  automationId,
  itemKey,
  itemLabel: `label ${itemKey}`,
  queuedAt,
  byHand
})

describe('CapacityStore', () => {
  it('keeps the run limit, and no limit once cleared', () => {
    const store = open()
    expect(store.capacity.runLimit()).toBeNull()
    store.capacity.setRunLimit(3, 1)
    store.capacity.setRunLimit(2, 2)
    expect(store.capacity.runLimit()).toBe(2)
    store.capacity.setRunLimit(null, 3)
    expect(store.capacity.runLimit()).toBeNull()
  })

  it('queues oldest first, and a requeued item keeps its place and any Run now', () => {
    const store = open()
    store.capacity.enqueue(item('a', 'x', 10, true))
    store.capacity.enqueue(item('b', 'y', 20))
    store.capacity.enqueue({ ...item('a', 'x', 30), itemLabel: 'renamed' })
    expect(store.capacity.queued()).toEqual([
      { ...item('a', 'x', 10, true), itemLabel: 'renamed' },
      item('b', 'y', 20)
    ])
  })

  it('dequeues the row it removes, and keeps only the items a tick left waiting', () => {
    const store = open()
    for (const [key, at] of [
      ['x', 1],
      ['y', 2],
      ['z', 3]
    ] as const) {
      store.capacity.enqueue(item('a', key, at))
    }
    store.capacity.enqueue(item('b', 'w', 4))
    expect(store.capacity.dequeue('a', 'x')).toEqual(item('a', 'x', 1))
    expect(store.capacity.dequeue('a', 'x')).toBeNull()
    store.capacity.keepOnly('a', ['z'])
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(['z', 'w'])
    store.capacity.forget('b')
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(['z'])
  })

  it('records a run peak only upward, and lists running runs oldest first', () => {
    const store = open()
    addRun(store, 'r2', 'a', 20)
    addRun(store, 'r1', 'a', 10)
    addRun(store, 'r3', 'a', 30)
    store.runs.update('r3', { status: 'done', finishedAt: 40 })
    store.capacity.recordPeak('r1', 500)
    store.capacity.recordPeak('r1', 300)
    expect(store.capacity.peaks(['r1', 'r2'])).toEqual(new Map([['r1', 500]]))
    expect(store.capacity.running().map((r) => r.id)).toEqual(['r1', 'r2'])
  })

  it("takes each automation's heaviest peak from its recent measured runs only", () => {
    const store = open()
    addRun(store, 'old', 'a', 0)
    store.capacity.recordPeak('old', 9_000)
    for (let n = 1; n <= RECENT_RUNS_FOR_PEAK; n++) {
      addRun(store, `a${n}`, 'a', n)
      store.capacity.recordPeak(`a${n}`, n)
    }
    addRun(store, 'b1', 'b', 1)
    store.capacity.recordPeak('b1', 70)
    addRun(store, 'unmeasured', 'c', 1)
    expect(store.capacity.heaviestPeaks()).toEqual(
      new Map([
        ['a', RECENT_RUNS_FOR_PEAK],
        ['b', 70]
      ])
    )
  })
})
