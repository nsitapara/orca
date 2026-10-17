import { describe, expect, it } from 'vitest'
import type { InboxStatus } from '../../shared/api-types'
import {
  queuedPreparation,
  PREPARATION_HOLD_MAX_MS,
  PREPARATION_LEASE_MS,
  type InboxPreparation
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

// A refused claim says which reason applies, after the prefix pilotcli reads as a skip; nothingToDo: nothing is left
// for worker-2 (its step stops), false: the card still needs a person (its step fails).
describe('a refused claim', () => {
  const at = 200
  it.each<[string, InboxStatus, Partial<InboxPreparation>, string, boolean]>([
    ['an answered card', 'done', {}, 'the card was already answered', true],
    ['a dismissed card', 'dismissed', {}, 'the card was dismissed', true],
    [
      'a newer request',
      'open',
      { revision: 2 },
      'the card was queued again since this run took it',
      true
    ],
    [
      'a card another run prepared',
      'open',
      { state: 'ready', runId: 'worker-1', attempt: 1 },
      'run worker-1 already prepared this card',
      true
    ],
    [
      'a card another run is preparing',
      'open',
      { state: 'generating', runId: 'worker-1', stepIdx: 0, attempt: 1, leaseUntil: at + 1 },
      'run worker-1 is preparing this card',
      true
    ],
    [
      'a blocked preparation',
      'open',
      { state: 'blocked', attempt: 1 },
      'its preparation is blocked until you Retry it on the card',
      false
    ],
    [
      'a preparation out of attempts',
      'open',
      { attempt: 2 },
      'every attempt is used (2 of 2) until you Retry it on the card',
      false
    ]
  ])('names %s', (_name, status, over, reason, nothingToDo) => {
    const store = setup()
    const p = store.inbox.get('item')?.preparation
    if (!p) {
      throw new Error('no preparation')
    }
    store.inboxPreparations.write('item', { ...p, ...over })
    if (status !== 'open') {
      store.inbox.update('item', { status }, at)
    }
    expect(store.inboxPreparations.claimRefusal('item', 1, 'worker-2', 0, at)).toMatchObject({
      message: `Preparation claim is stale: ${reason}`,
      nothingToDo
    })
    expect(() => store.inboxPreparations.claim('item', 1, 'worker-2', 0, at)).toThrow(reason)
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
