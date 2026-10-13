import { describe, expect, it } from 'vitest'
import type { RunRow, TickTrigger } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import { PilotStore } from '../store/store'
import { HANDOVER_EXPIRY_MS } from './tick-handover'
import { handoverService } from './service'

const AT = Date.UTC(2026, 9, 13, 18, 5)

describe('handoverService: what pilot-services wires', () => {
  it('hands a run’s output over at its end, triggers through the late-set trigger, and housekeeps', () => {
    const store = PilotStore.open(':memory:')
    const sender = testDefinition({
      id: 'open',
      job: {
        id: '13',
        name: 'N',
        stage: 1,
        label: 'Open',
        feeds: [{ to: 'start', pass: { id: 'ticket' }, run: 'now', when: 'success', caption: null }]
      },
      steps: [testStep({ name: 'ticket', agent: 'shell', run: './t.sh', outputs: ['ticket'] })]
    })
    const receiver = testDefinition({
      id: 'start',
      items: {
        kind: 'linear_ticket',
        where: { ids_from: { feed: true } },
        match: [],
        customFields: []
      }
    })
    const service = handoverService({
      store,
      now: () => AT,
      definitionFor: (id) => [sender, receiver].find((d) => d.id === id) ?? null,
      log: () => {}
    })
    const triggered: [string, TickTrigger][] = []
    service.deps.trigger = (id, cause) => triggered.push([id, cause])
    const run = { id: 'run-1', automationId: 'open', trigger: 'schedule' } as RunRow
    store.runs.create({
      id: 'run-1',
      automationId: 'open',
      tickId: 1,
      itemKey: 'k',
      itemLabel: 'k',
      worktreePath: null,
      startedAt: AT
    })
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 'ticket',
      agent: 'shell',
      skill: null,
      startedAt: AT
    })
    store.advance.mergeStepOutputs('run-1', 0, { ticket: 'WEB-1' })
    service.runEnd.after(
      store.transaction(() => service.runEnd.write(run, { status: 'done', outcome: 'Done' }))
    )
    expect(triggered.map(([id]) => id)).toEqual(['start'])
    store.handovers.add({
      senderId: 'x',
      senderRunId: 'old',
      receiverId: 'y',
      itemIds: ['OLD-1'],
      at: AT - HANDOVER_EXPIRY_MS - 1
    })
    service.housekeep()
    expect(store.handovers.pending('y', 10)).toEqual([])
    expect(store.handovers.pending('start', 10).map((h) => h.itemId)).toEqual(['WEB-1'])
  })
})
