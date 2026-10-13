import { describe, expect, it } from 'vitest'
import type { RunRow } from '../../shared/api-types'
import { PilotStore } from '../store/store'
import { closeRun, type RunEndHandover } from './run-close'

const AT = Date.UTC(2026, 9, 13, 18, 5)
const CAUSE = { automationId: 'open', runId: 'run-1', stage: 1, ids: ['WEB-1'] }

function setup() {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'run-1',
    automationId: 'open',
    tickId: 1,
    itemKey: 'pipeline:7',
    itemLabel: '#7',
    worktreePath: null,
    startedAt: AT
  })
  store.markHandled('open', '7', 'run-1', AT)
  const run = store.runs.get('run-1') as RunRow
  const logs: string[] = []
  return { store, run, logs, deps: { store, now: () => AT, log: (m: string) => logs.push(m) } }
}

describe('closeRun: a run’s end and its handover commit together', () => {
  it('writes the handover inside the transaction that ends the run, and triggers only after the commit', () => {
    const { store, run, deps } = setup()
    const seen: string[] = []
    const handover: RunEndHandover = {
      write: () => {
        store.handovers.add({
          senderId: 'open',
          senderRunId: 'run-1',
          receiverId: 'start',
          itemIds: ['WEB-1'],
          at: AT
        })
        seen.push(`write while ${store.runs.get('run-1')?.status}`)
        return { note: null, triggers: [{ to: 'start', cause: CAUSE }] }
      },
      after: (written) => {
        seen.push(
          `after while ${store.runs.get('run-1')?.status}: ${written.triggers.map((t) => t.to).join()}`
        )
      }
    }
    closeRun({ ...deps, handover }, run, { status: 'done', outcome: 'Done' })
    expect(seen).toEqual(['write while running', 'after while done: start'])
    expect(store.handovers.pending('start', 10).map((h) => h.itemId)).toEqual(['WEB-1'])
    expect(store.handledRows('open')[0].status).toBe('done')
  })

  it('rolls the run’s end back with a handover insert that fails, so the next close retries both', () => {
    const { store, run, deps } = setup()
    const failing: RunEndHandover = {
      write: () => {
        store.handovers.add({
          senderId: 'open',
          senderRunId: 'run-1',
          receiverId: 'start',
          itemIds: ['WEB-1'],
          at: AT
        })
        throw new Error('disk I/O error')
      },
      after: () => {
        throw new Error('never after a rollback')
      }
    }
    expect(() =>
      closeRun({ ...deps, handover: failing }, run, { status: 'done', outcome: 'Done' })
    ).toThrow('disk I/O error')
    expect(store.runs.get('run-1')).toMatchObject({ status: 'running', finishedAt: null })
    expect(store.handledRows('open')[0].status).toBe('started')
    expect(store.handovers.pending('start', 10)).toEqual([])
  })

  it('adds the handover’s note to the run’s outcome, so Activity shows ids it refused', () => {
    const { store, run, deps } = setup()
    const noting: RunEndHandover = {
      write: () => ({
        note: 'handover refused "web 1": not a Linear id like WEB-123',
        triggers: []
      }),
      after: () => {}
    }
    closeRun({ ...deps, handover: noting }, run, { status: 'done', outcome: 'Done' })
    expect(store.runs.get('run-1')?.outcome).toBe(
      'Done; handover refused "web 1": not a Linear id like WEB-123'
    )
  })

  it('keeps the run closed and logs when the after-commit trigger throws', () => {
    const { store, run, deps, logs } = setup()
    const throwing: RunEndHandover = {
      write: () => ({ note: null, triggers: [{ to: 'start', cause: CAUSE }] }),
      after: () => {
        throw new Error('scheduler gone')
      }
    }
    closeRun({ ...deps, handover: throwing }, run, { status: 'done', outcome: 'Done' })
    expect(store.runs.get('run-1')?.status).toBe('done')
    expect(logs.join('\n')).toContain('scheduler gone')
  })
})
