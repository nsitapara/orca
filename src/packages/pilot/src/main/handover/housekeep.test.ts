import { describe, expect, it } from 'vitest'
import { PilotStore } from '../store/store'
import { handoverHousekeeper, HANDOVER_RETENTION_MS } from './housekeep'
import { HANDOVER_EXPIRY_MS } from './tick-handover'

const HOUR = 3_600_000

describe('handoverHousekeeper: the scheduler pass expires and prunes handovers, at most once an hour', () => {
  it('runs on the first pass, then not again until an hour has passed, and logs what it changed', () => {
    const store = PilotStore.open(':memory:')
    let now = 100 * 86_400_000
    const logs: string[] = []
    const keeper = handoverHousekeeper(
      store,
      () => now,
      (m) => logs.push(m)
    )
    store.handovers.add({
      senderId: 'a',
      senderRunId: 'r1',
      receiverId: 'b',
      itemIds: ['WEB-1'],
      at: now - HANDOVER_EXPIRY_MS - 1
    })
    expect(keeper.passIfDue()).toEqual({ expired: 1, pruned: 0 })
    expect(logs).toEqual([
      '[pilot] handovers: 1 pending past 7 days expired, 0 settled past 30 days pruned'
    ])
    store.handovers.add({
      senderId: 'a',
      senderRunId: 'r2',
      receiverId: 'b',
      itemIds: ['WEB-2'],
      at: now - HANDOVER_EXPIRY_MS - 1
    })
    now += HOUR - 1
    expect(keeper.passIfDue()).toBeNull()
    now += 1
    expect(keeper.passIfDue()).toEqual({ expired: 1, pruned: 0 })
    now += HANDOVER_RETENTION_MS + HOUR
    expect(keeper.passIfDue()).toEqual({ expired: 0, pruned: 2 })
  })

  it('says nothing when there was nothing to do', () => {
    const logs: string[] = []
    const keeper = handoverHousekeeper(
      PilotStore.open(':memory:'),
      () => 1,
      (m) => logs.push(m)
    )
    expect(keeper.passIfDue()).toEqual({ expired: 0, pruned: 0 })
    expect(logs).toEqual([])
  })

  it('records an Activity event on the receiving stage for each id it expires, naming the sender’s stage', () => {
    const store = PilotStore.open(':memory:')
    const now = 100 * 86_400_000
    const keeper = handoverHousekeeper(
      store,
      () => now,
      () => {},
      (id) => (id === 'open' ? 1 : null)
    )
    store.handovers.add({
      senderId: 'open',
      senderRunId: 'r1',
      receiverId: 'start',
      itemIds: ['WEB-2123'],
      at: now - HANDOVER_EXPIRY_MS - 1
    })
    store.handovers.add({
      senderId: 'gone',
      senderRunId: 'r2',
      receiverId: 'start',
      itemIds: ['WEB-9'],
      at: now - HANDOVER_EXPIRY_MS - 1
    })
    keeper.passIfDue()
    const events = store.events.list({ kinds: ['handover_expired'], automationId: 'start' })
    expect(events.map((e) => [e.at, e.itemKey, e.payload.text])).toEqual([
      [now, 'WEB-2123', 'Handover of WEB-2123 from stage 1 expired after 7 days'],
      [now, 'WEB-9', 'Handover of WEB-9 from gone expired after 7 days']
    ])
    expect(store.events.list({ kinds: ['handover_expired'], automationId: 'open' })).toEqual([])
  })
})
