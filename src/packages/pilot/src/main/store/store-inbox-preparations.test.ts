import { describe, expect, it } from 'vitest'
import {
  queuedPreparation,
  PREPARATION_HOLD_MAX_MS,
  PREPARATION_LEASE_MS
} from '../../shared/preparation'
import { PilotStore } from './store'

function setup() {
  const store = PilotStore.open(':memory:')
  store.inbox.add({
    id: 'item',
    automationId: 'origin',
    runId: 'origin-run',
    stepIdx: 0,
    itemKey: 'mr:1',
    worktreePath: '/wt',
    person: 'nish',
    type: 'question',
    title: 'Decision',
    context: 'Context',
    options: [],
    suggested: null,
    detailsMd: null,
    action: null,
    actionArgs: null,
    digest: 'digest',
    createdAt: 100,
    source: 'engine',
    vaultRef: null,
    preparation: queuedPreparation(
      {
        key: 'decision',
        context: 'Self contained investigation',
        requirements: ['context'],
        maxAttempts: 2
      },
      100
    )
  })
  return store
}

describe('preparation leases', () => {
  it('reclaims an expired attempt, refuses the old result, and stops after the retry budget', () => {
    const store = setup()
    const queue = store.inboxPreparations
    const first = queue.claim('item', 1, 'worker-1', 0, 100)
    expect(queue.claim('item', 1, 'worker-1', 0, 101).preparation?.attempt).toBe(1)
    expect(first.automationId).toBe('origin')
    expect(first.runId).toBe('origin-run')
    expect(() => queue.claim('item', 1, 'worker-2', 0, 101)).toThrow('stale')
    const later = 101 + PREPARATION_LEASE_MS
    queue.recoverExpired(later)
    expect(queue.listEligible(later)).toHaveLength(1)
    expect(queue.claim('item', 1, 'worker-2', 0, later).preparation?.attempt).toBe(2)
    expect(() =>
      queue.requireClaim('item', { revision: 1, attempt: 1, runId: 'worker-1', stepIdx: 0 }, later)
    ).toThrow('stale')
    queue.fail(
      'item',
      { revision: 1, attempt: 2, runId: 'worker-2', stepIdx: 0 },
      'Missing screenshot',
      true,
      later + 1
    )
    expect(store.inbox.get('item')?.preparation).toMatchObject({
      state: 'blocked',
      error: 'Missing screenshot'
    })
    expect(queue.listEligible(later + 2)).toEqual([])
    store.close()
  })
})

// M5: the lease is a liveness hint. It has expired only once it has lapsed AND the claiming step no longer runs; a
// long worker whose step Pilot still sees running keeps its claim.
describe('a lapsed lease', () => {
  function claimed(stepStatus: 'running' | 'done' | null) {
    const store = setup()
    if (stepStatus) {
      store.runs.create({
        id: 'worker-1',
        automationId: 'prepare',
        tickId: null,
        itemKey: 'item',
        itemLabel: 'Decision',
        worktreePath: '/wt',
        startedAt: 100
      })
      store.runs.createStep({
        runId: 'worker-1',
        idx: 0,
        name: 'prepare',
        agent: 'claude',
        skill: 'prepare-inbox-item-context',
        startedAt: 100,
        status: stepStatus
      })
    }
    store.inboxPreparations.claim('item', 1, 'worker-1', 0, 100)
    return { store, queue: store.inboxPreparations, later: 101 + PREPARATION_LEASE_MS }
  }
  const mine = { revision: 1, attempt: 1, runId: 'worker-1', stepIdx: 0 }

  it('holds while the claiming step still runs', () => {
    const { store, queue, later } = claimed('running')
    expect(queue.requireClaim('item', mine, later).preparation.state).toBe('generating')
    expect(queue.progress('item', mine, 'Still drafting', later).preparation?.leaseUntil).toBe(
      later + PREPARATION_LEASE_MS
    )
    queue.recoverExpired(later * 2)
    expect(store.inbox.get('item')?.preparation?.state).toBe('generating')
    expect(queue.listEligible(later * 2)).toEqual([])
    expect(() => queue.claim('item', 1, 'worker-2', 0, later * 2)).toThrow('stale')
    expect(queue.claim('item', 1, 'worker-1', 0, later * 2).preparation?.attempt).toBe(1)
    store.close()
  })

  // A step that never ends (no timeout, a terminal that won't close) can't hold a card forever.
  it('expires at the hard cap even while its step runs and its lease is fresh', () => {
    const { store, queue } = claimed('running')
    const cap = 100 + PREPARATION_HOLD_MAX_MS
    queue.progress('item', mine, 'Still drafting', cap - 1)
    expect(() => queue.requireClaim('item', mine, cap)).toThrow('stale')
    expect(queue.listEligible(cap)).toHaveLength(1)
    queue.recoverExpired(cap)
    expect(store.inbox.get('item')?.preparation).toMatchObject({ state: 'queued' })
    store.close()
  })

  it.each(['done', null] as const)('expires once the claiming step is %s', (status) => {
    const { store, queue, later } = claimed(status)
    expect(() => queue.requireClaim('item', mine, later)).toThrow('stale')
    expect(queue.listEligible(later)).toHaveLength(1)
    queue.recoverExpired(later)
    expect(store.inbox.get('item')?.preparation).toMatchObject({
      state: 'queued',
      error: 'Preparation lease expired'
    })
    store.close()
  })
})
