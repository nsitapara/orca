import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'

function storeWithItems(...ids: string[]): PilotStore {
  const store = PilotStore.open(':memory:')
  for (const id of ids) {
    store.inbox.add({
      id,
      automationId: 'a',
      runId: 'run-1',
      stepIdx: 0,
      itemKey: 'mr:1',
      worktreePath: '/wt',
      person: 'nish',
      type: 'question',
      title: 't',
      context: '',
      options: [],
      suggested: null,
      detailsMd: null,
      action: null,
      actionArgs: null,
      digest: 'd1',
      createdAt: 1,
      source: 'engine',
      vaultRef: null
    })
  }
  return store
}

describe('QueueStore', () => {
  it('queues an answer not ready until its settle time, and lists what is still to dispatch', () => {
    const store = storeWithItems('i1', 'i2', 'i3')
    const late = store.queue.enqueue('i1', 500, 100)
    const early = store.queue.enqueue('i2', 300, 100)
    const sent = store.queue.enqueue('i3', 200, 100)
    store.queue.update(sent, { state: 'dispatched', dispatchedRunId: 'run-9' }, 210)
    expect(store.queue.get(late)).toEqual({
      id: late,
      inboxItemId: 'i1',
      state: 'not_ready',
      holdReason: null,
      holdDetail: null,
      readyAt: 500,
      attempts: 0,
      route: null,
      targetSessionId: null,
      dispatchedRunId: null,
      updatedAt: 100
    })
    expect(store.queue.pending().map((q) => q.id)).toEqual([early, late])
    expect(store.queue.get(9999)).toBeNull()
  })

  it('records a hold with its reason, then the dispatch with its route and run', () => {
    const store = storeWithItems('i1')
    const id = store.queue.enqueue('i1', 300, 100)
    store.queue.update(id, { state: 'held', holdReason: 'typing', attempts: 1 }, 310)
    expect(store.queue.get(id)).toMatchObject({ state: 'held', holdReason: 'typing', attempts: 1 })
    store.queue.update(
      id,
      {
        state: 'dispatched',
        holdReason: null,
        route: 'fork',
        targetSessionId: 'sess-1',
        dispatchedRunId: 'run-2'
      },
      400
    )
    expect(store.queue.forInboxItem('i1')).toMatchObject([
      {
        state: 'dispatched',
        holdReason: null,
        route: 'fork',
        targetSessionId: 'sess-1',
        dispatchedRunId: 'run-2',
        updatedAt: 400
      }
    ])
  })

  it('stores a hold as one "<code>: <words>" column and reads it back as reason and detail', () => {
    const store = storeWithItems('i1')
    const id = store.queue.enqueue('i1', 300, 100)
    store.queue.update(
      id,
      { state: 'held', holdReason: 'worktree_busy', holdDetail: 'agent working: fix: lint' },
      310
    )
    expect(store.queue.get(id)).toMatchObject({
      holdReason: 'worktree_busy',
      holdDetail: 'agent working: fix: lint'
    })
    store.queue.update(id, { holdReason: 'quota' }, 320)
    expect(store.queue.get(id)).toMatchObject({ holdReason: 'quota', holdDetail: null })
    store.queue.update(id, { holdReason: null, holdDetail: null }, 330)
    expect(store.queue.get(id)).toMatchObject({ holdReason: null, holdDetail: null })
  })

  it('lists rows by state, counts pending answers per item, and removes an item pending rows', () => {
    const store = storeWithItems('i1', 'i2')
    const first = store.queue.enqueue('i1', 300, 100)
    store.queue.enqueue('i2', 200, 100)
    store.queue.update(first, { state: 'dispatched' }, 150)
    expect(store.queue.list(['dispatched']).map((q) => q.inboxItemId)).toEqual(['i1'])
    expect(store.queue.list(['not_ready', 'ready', 'held']).map((q) => q.inboxItemId)).toEqual([
      'i2'
    ])
    expect(store.queue.pendingAnswerCount('a', 'mr:1')).toBe(1)
    expect(store.queue.pendingAnswerCount('a', 'mr:2')).toBe(0)
    expect(store.queue.pendingAnswerCount('b', 'mr:1')).toBe(0)
    expect(store.queue.removePending('i1')).toBe(0)
    expect(store.queue.removePending('i2')).toBe(1)
    expect(store.queue.pendingAnswerCount('a', 'mr:1')).toBe(0)
  })

  it('lets one holder claim a worktree until the claim runs out', () => {
    const { queue } = PilotStore.open(':memory:')
    expect(queue.claim('/wt', 'dispatch-1', 1000, 0)).toBe(true)
    expect(queue.claim('/wt', 'dispatch-2', 2000, 500)).toBe(false)
    expect(queue.claimHolder('/wt', 500)).toBe('dispatch-1')
    expect(queue.claim('/wt', 'dispatch-1', 1500, 500)).toBe(true)
    expect(queue.claimHolder('/wt', 1500)).toBeNull()
    expect(queue.claim('/wt', 'dispatch-2', 3000, 1500)).toBe(true)
    queue.release('/wt', 'dispatch-1')
    expect(queue.claimHolder('/wt', 1600)).toBe('dispatch-2')
    queue.release('/wt', 'dispatch-2')
    expect(queue.claimHolder('/wt', 1600)).toBeNull()
  })

  it('commits an answer and its queue row together, or neither', () => {
    const store = storeWithItems('i1')
    expect(() =>
      store.transaction(() => {
        store.inbox.saveAnswer(
          'i1',
          { option: 0, text: null, digest: 'd1', via: 'page' },
          'nish',
          120
        )
        store.queue.enqueue('no-such-item', 300, 120)
      })
    ).toThrow(/FOREIGN KEY/)
    expect(store.inbox.get('i1')?.status).toBe('open')
    expect(store.queue.pending()).toEqual([])
  })
})
