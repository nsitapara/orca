import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'

const open = () => PilotStore.open(':memory:')
const SENT = { senderId: 'dev-e2e-fix', receiverId: 'dev-e2e-fix-start', at: 100 }

describe('HandoverStore: ids one stage hands the next, kept until a tick of the receiver reads them', () => {
  it('writes each id once per (sender run, receiver, id), and says which ids were new', () => {
    const store = open()
    expect(
      store.handovers.add({ ...SENT, senderRunId: 'r1', itemIds: ['WEB-1', 'WEB-2'] })
    ).toEqual(['WEB-1', 'WEB-2'])
    expect(
      store.handovers.add({ ...SENT, senderRunId: 'r1', itemIds: ['WEB-2', 'WEB-3'] })
    ).toEqual(['WEB-3'])
    expect(store.handovers.add({ ...SENT, senderRunId: 'r2', itemIds: ['WEB-1'] })).toEqual([
      'WEB-1'
    ])
    expect(
      store.handovers
        .pending('dev-e2e-fix-start', 10)
        .map((h) => [h.senderRunId, h.itemId, h.state])
    ).toEqual([
      ['r1', 'WEB-1', 'pending'],
      ['r1', 'WEB-2', 'pending'],
      ['r1', 'WEB-3', 'pending'],
      ['r2', 'WEB-1', 'pending']
    ])
    expect(store.handovers.pending('another-stage', 10)).toEqual([])
  })

  it('reads at most <limit> pending rows, oldest first', () => {
    const store = open()
    store.handovers.add({ ...SENT, senderRunId: 'r1', itemIds: ['WEB-1', 'WEB-2', 'WEB-3'] })
    expect(store.handovers.pending('dev-e2e-fix-start', 2).map((h) => h.itemId)).toEqual([
      'WEB-1',
      'WEB-2'
    ])
  })

  it('consumes the rows a tick read, with how the tick decided each; the rest stay pending', () => {
    const store = open()
    store.handovers.add({ ...SENT, senderRunId: 'r1', itemIds: ['WEB-1', 'WEB-2', 'WEB-3'] })
    const [one, two] = store.handovers.pending('dev-e2e-fix-start', 10)
    store.handovers.consume(7, 200, [
      { rowId: one.id, verdict: 'started', reason: 'Started', runId: 'run-9' },
      {
        rowId: two.id,
        verdict: null,
        reason: 'Not read: its source returned no such item',
        runId: null
      }
    ])
    expect(store.handovers.pending('dev-e2e-fix-start', 10).map((h) => h.itemId)).toEqual(['WEB-3'])
    expect(store.handovers.consumedBy([7, 8])).toEqual(
      new Map([
        [
          7,
          [
            expect.objectContaining({
              itemId: 'WEB-1',
              state: 'consumed',
              consumedAt: 200,
              tickId: 7,
              verdict: 'started',
              runId: 'run-9'
            }),
            expect.objectContaining({ itemId: 'WEB-2', verdict: null, runId: null })
          ]
        ]
      ])
    )
  })

  it('never consumes a row twice: a second tick leaves the first one’s record', () => {
    const store = open()
    store.handovers.add({ ...SENT, senderRunId: 'r1', itemIds: ['WEB-1'] })
    const [row] = store.handovers.pending('dev-e2e-fix-start', 10)
    store.handovers.consume(7, 200, [
      { rowId: row.id, verdict: 'started', reason: 'Started', runId: 'x' }
    ])
    store.handovers.consume(8, 300, [
      { rowId: row.id, verdict: 'notdue', reason: 'Done', runId: null }
    ])
    expect(store.handovers.consumedBy([7, 8]).get(8)).toBeUndefined()
    expect(store.handovers.consumedBy([7]).get(7)?.[0]).toMatchObject({
      tickId: 7,
      verdict: 'started'
    })
  })

  it('names the most recent handover between two stages: every id of the newest sender run', () => {
    const store = open()
    expect(store.handovers.latest('dev-e2e-fix', 'dev-e2e-fix-start')).toEqual([])
    store.handovers.add({ ...SENT, senderRunId: 'r1', itemIds: ['WEB-1'] })
    store.handovers.add({ ...SENT, at: 300, senderRunId: 'r2', itemIds: ['WEB-4', 'WEB-5'] })
    store.handovers.add({
      ...SENT,
      at: 400,
      senderRunId: 'r3',
      receiverId: 'other',
      itemIds: ['X-1']
    })
    expect(
      store.handovers
        .latest('dev-e2e-fix', 'dev-e2e-fix-start')
        .map((h) => [h.senderRunId, h.itemId])
    ).toEqual([
      ['r2', 'WEB-4'],
      ['r2', 'WEB-5']
    ])
  })

  it('keeps what triggered a tick, read back by tick id', () => {
    const store = open()
    const tickId = store.startTick('dev-e2e-fix-start', false, 1)
    const other = store.startTick('dev-e2e-fix-start', false, 2)
    const trigger = { automationId: 'dev-e2e-fix', runId: 'r1', stage: 1, ids: ['WEB-2123'] }
    store.handovers.setTickTrigger(tickId, trigger)
    expect(store.handovers.tickTriggers([tickId, other])).toEqual(new Map([[tickId, trigger]]))
  })
})
