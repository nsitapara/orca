import { describe, expect, it } from 'vitest'
import { queuedPreparation, PREPARATION_LEASE_MS } from '../../shared/preparation'
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
