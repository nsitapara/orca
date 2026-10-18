import { describe, expect, it } from 'vitest'
import type { RunRow } from '../../shared/api-types'
import { testDefinition } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import { parsePeopleYaml } from '../../shared/people'
import { giveUpOnFailure } from '../capacity/give-up'
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

  // A deferred env: nothing ran, so the item is free for the next tick and the next stage gets nothing.
  it('release: nothing is handed on, and the once_per key is freed', () => {
    const { store, run, deps } = setup()
    const written: string[] = []
    const handover: RunEndHandover = {
      write: () => {
        written.push('write')
        return { note: null, triggers: [] }
      },
      after: () => {}
    }
    closeRun(
      { ...deps, handover },
      run,
      { status: 'cancelled', outcome: 'Deferred: cap' },
      { release: true }
    )
    expect(store.runs.get('run-1')).toMatchObject({ status: 'cancelled', outcome: 'Deferred: cap' })
    expect(written).toEqual([])
    expect(store.handledRows('open')).toEqual([])
  })
})

describe('closeRun: a failed run counts a failure on its key', () => {
  const people = parsePeopleYaml('people:\n  - { id: nish, name: Nish }\n')
  const job = testDefinition({ id: 'open', name: '13 Open MR' })

  // Four runs of one key in a row, each failing; the hook gives up past the store's retry limit (2).
  function failFourTimes(def: AutomationDefinition) {
    if (!people.ok) {
      throw new Error('setup')
    }
    const directory = people.directory
    const store = PilotStore.open(':memory:')
    const inbox = { store, now: () => AT, definitions: () => [def], people: () => directory }
    const logs: string[] = []
    const failureCounted = giveUpOnFailure(
      inbox,
      () => def,
      (m) => logs.push(m)
    )
    const counts: number[] = []
    for (let n = 1; n <= 4; n += 1) {
      const id = `run-${n}`
      store.runs.create({
        id,
        automationId: 'open',
        tickId: 1,
        itemKey: 'pipeline:7',
        itemLabel: '#7',
        worktreePath: null,
        startedAt: AT
      })
      store.markHandled('open', '7', id, AT)
      const deps = {
        store,
        now: () => AT,
        log: (m: string) => logs.push(m),
        failureCounted: (run: RunRow, failures: number) => {
          counts.push(failures)
          failureCounted(run, failures)
        }
      }
      const run = store.runs.get(id)
      if (!run) {
        throw new Error('setup')
      }
      closeRun(deps, run, { status: 'failed', outcome: `agent exited ${n}` })
    }
    return { store, counts, logs }
  }

  it('posts one flagged card on the failure that first passes the retry limit, and none after', () => {
    const { store, counts, logs } = failFourTimes(job)
    expect(counts).toEqual([1, 2, 3, 4])
    expect(
      store.inbox.list({ automationId: 'open' }).map((i) => [i.type, i.itemKey, i.title, i.context])
    ).toEqual([
      [
        'flagged',
        'pipeline:7',
        '13 Open MR failed 3 times: #7',
        'agent exited 3. Retry it from Running.'
      ]
    ])
    expect(logs).toEqual([])
  })

  it('never gives up on an ask-first job: you approve each run', () => {
    const { store } = failFourTimes({ ...job, start: 'ask_first' })
    expect(store.inbox.list({ automationId: 'open' })).toEqual([])
  })

  it('counts nothing for a done run', () => {
    const { store, run, deps } = setup()
    const counted: number[] = []
    closeRun({ ...deps, failureCounted: (_run, failures) => counted.push(failures) }, run, {
      status: 'done',
      outcome: 'Done'
    })
    expect(counted).toEqual([])
    expect(store.handledRows('open')[0]).toMatchObject({ status: 'done', failures: 0 })
  })
})
