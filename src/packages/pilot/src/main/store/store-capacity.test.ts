import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Database from '../../../../../main/sqlite/sync-database'
import { PilotStore } from './store'
import { RECENT_RUNS_FOR_PEAK, type QueuedItem } from './store-capacity'

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

const item = (
  automationId: string,
  itemKey: string,
  queuedAt: number,
  byHand = false
): QueuedItem => ({
  automationId,
  itemKey,
  itemLabel: `label ${itemKey}`,
  queuedAt,
  byHand,
  dueAt: queuedAt,
  holdCode: 'capacity',
  holdDetail: 'Waiting for a slot',
  checkedAt: queuedAt
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
      { ...item('a', 'x', 10, true), itemLabel: 'renamed', checkedAt: 30 },
      item('b', 'y', 20)
    ])
  })

  it('orders by due time, not join time', () => {
    const store = open()
    store.capacity.enqueue({ ...item('a', 'B', 10), dueAt: 200 })
    store.capacity.enqueue({ ...item('a', 'A', 20), dueAt: 100 })
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(['A', 'B'])
  })

  it('re-enqueue keeps the earliest due time and replaces the hold', () => {
    const store = open()
    expect(store.capacity.enqueue(item('a', 'x', 10))).toEqual({ changed: true })
    const later = {
      ...item('a', 'x', 50),
      dueAt: 50,
      holdCode: 'window' as const,
      holdDetail: 'Opens at 9',
      checkedAt: 60
    }
    expect(store.capacity.enqueue(later)).toEqual({ changed: true })
    expect(store.capacity.queued()).toEqual([{ ...later, queuedAt: 10, dueAt: 10 }])
    expect(store.capacity.enqueue({ ...later, checkedAt: 70 })).toEqual({ changed: false })
    expect(store.capacity.queued()[0].checkedAt).toBe(70)
  })

  it('sorts a row from an older build by its join time and updates it as a changed hold', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pilot-capacity-')), 'db.sqlite')
    const store = PilotStore.open(path)
    const db = new Database(path)
    db.exec(
      "INSERT INTO run_queue (automation_id, item_key, item_label, queued_at, by_hand) VALUES ('a', 'old', 'old', 50, 0)"
    )
    store.capacity.enqueue({ ...item('a', 'early', 10), dueAt: 10 })
    store.capacity.enqueue({ ...item('a', 'late', 90), dueAt: 90 })
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(['early', 'old', 'late'])
    expect(store.capacity.queuedFor(['old', 'late']).map((q) => q.itemKey)).toEqual(['old', 'late'])
    expect(store.capacity.enqueue({ ...item('a', 'old', 80), dueAt: 80 })).toEqual({
      changed: true
    })
    expect(store.capacity.queued().find((q) => q.itemKey === 'old')?.dueAt).toBe(50)
  })

  it('queuedFor returns only those keys', () => {
    const store = open()
    store.capacity.enqueue(item('a', 'x', 1))
    store.capacity.enqueue(item('a', 'y', 2))
    store.capacity.enqueue(item('b', 'x', 3))
    expect(store.capacity.queuedFor(['x']).map((q) => `${q.automationId}/${q.itemKey}`)).toEqual([
      'a/x',
      'b/x'
    ])
  })

  it("dequeues the row it removes, keeps only the items a tick left waiting, and forgets a job's slot waiters", () => {
    const store = open()
    for (const [key, at] of [
      ['x', 1],
      ['y', 2],
      ['z', 3]
    ] as const) {
      store.capacity.enqueue(item('a', key, at))
    }
    store.capacity.enqueue(item('b', 'w', 4))
    store.capacity.enqueue({ ...item('b', 'held', 5), holdCode: 'quota' })
    expect(store.capacity.dequeue('a', 'x')).toEqual(item('a', 'x', 1))
    expect(store.capacity.dequeue('a', 'x')).toBeNull()
    store.capacity.keepOnly('a', ['z'])
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(['z', 'w', 'held'])
    store.capacity.forgetSlotWaiters('b')
    expect(store.capacity.queued().map((q) => q.itemKey)).toEqual(['z', 'held'])
  })

  it("lists the given jobs' newest ended runs, leaving out running, imported and other jobs' runs", () => {
    const store = open()
    for (const [id, automationId, finishedAt] of [
      ['old', 'a', 10],
      ['new', 'a', 30],
      ['mid', 'b', 20],
      ['other', 'c', 40]
    ] as const) {
      addRun(store, id, automationId, 1)
      store.runs.update(id, { status: 'done', finishedAt })
    }
    addRun(store, 'live', 'a', 50)
    store.runs.create({
      id: 'imported',
      automationId: 'a',
      tickId: null,
      itemKey: 'imported',
      itemLabel: 'imported',
      worktreePath: null,
      startedAt: 1,
      imported: true
    })
    store.runs.update('imported', { status: 'done', finishedAt: 60 })
    expect(store.capacity.finished(['a', 'b'], 10).map((r) => r.id)).toEqual(['new', 'mid', 'old'])
    expect(store.capacity.finished(['a', 'b'], 2).map((r) => r.id)).toEqual(['new', 'mid'])
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
