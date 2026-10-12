import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ImportPlan } from '../../../shared/api-types'
import { PilotStore } from '../../store/store'
import type { NewInboxItem } from '../../store/store-inbox'
import { importedRunId } from '../../store/store-import'
import { applyImport, previewImport } from './apply'

const ID = 'fix-failed-ci'

function setup(): { dir: string; store: PilotStore } {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-import-'))
  return { dir, store: PilotStore.open(join(dir, 'pilot-automations.db')) }
}

function plan(overrides: Partial<ImportPlan> = {}): ImportPlan {
  return {
    automationId: ID,
    handled: [
      { onceKey: '1587:2933991087', status: 'done' },
      { onceKey: '1590:2934000001', status: 'failed' }
    ],
    sessions: [
      { worktreePath: '/wt/usage', terminalHandle: 'term_1', agent: 'claude', label: 'usage' }
    ],
    files: [],
    notes: [],
    ...overrides
  }
}

// An open card imported from a vault note, as Task 27 writes it.
const card = (id: string, vaultRef: string): NewInboxItem => ({
  id,
  automationId: ID,
  runId: null,
  stepIdx: null,
  itemKey: 'mr:1587',
  worktreePath: null,
  person: 'nish',
  type: 'question',
  title: 'Push the fix?',
  context: '',
  options: [],
  suggested: null,
  detailsMd: null,
  action: null,
  actionArgs: null,
  digest: 'd1',
  createdAt: 1,
  source: 'import',
  vaultRef
})

describe('previewImport', () => {
  it('counts what Pilot already holds and writes nothing', () => {
    const { store } = setup()
    store.markHandled(ID, '1587:2933991087', 'run-1', 5)
    const result = previewImport(store, plan())
    expect(result).toMatchObject({
      apply: false,
      handled: { total: 2, present: 1, added: 0 },
      seen: { total: 0, present: 0, added: 0 },
      sessions: { total: 1, present: 0, added: 0 },
      dispatched: { total: 0, present: 0, added: 0 },
      files: { total: 0, present: 0, added: 0 }
    })
    expect(store.handledKeys(ID)).toEqual(new Set(['1587:2933991087']))
    expect(store.runs.get(importedRunId(ID, 'term_1'))).toBeNull()
  })
})

describe('applyImport', () => {
  it('adds the missing handled keys with their status and never replaces a key Pilot holds', () => {
    const { store } = setup()
    store.markHandled(ID, '1587:2933991087', 'run-1', 5)
    const result = applyImport(store, plan({ sessions: [] }), 1_000)
    expect(result.handled).toEqual({ total: 2, present: 1, added: 1 })
    expect(store.imports.handledStatus(ID, '1590:2934000001')).toBe('failed')
    // Pilot's own row keeps its status (the V2 default) and its run.
    expect(store.imports.handledStatus(ID, '1587:2933991087')).toBe('started')
  })

  it("keeps the time and failure a plan gives a key, else stamps the import's own time", () => {
    const { store } = setup()
    const handled = [
      { onceKey: 'k1', status: 'failed' as const, at: 40, failedAt: 40 },
      { onceKey: 'k2', status: 'done' as const }
    ]
    applyImport(store, plan({ handled, sessions: [] }), 1_000)
    expect(store.handledRows(ID)).toEqual([
      { onceKey: 'k1', runId: null, at: 40, status: 'failed', failedAt: 40 },
      { onceKey: 'k2', runId: null, at: 1_000, status: 'done', failedAt: null }
    ])
  })

  it('adds nothing the second time', () => {
    const { store } = setup()
    applyImport(store, plan(), 1_000)
    const again = applyImport(store, plan(), 2_000)
    expect([again.handled.added, again.sessions.added]).toEqual([0, 0])
    expect([again.handled.present, again.sessions.present]).toEqual([2, 1])
  })

  it('adds the missing seen rows with their time and never replaces one Pilot holds', () => {
    const { store } = setup()
    store.markSeen(ID, 'wt:a', 5)
    const seen = [
      { itemKey: 'wt:a', at: 1 },
      { itemKey: 'wt:b', at: 2 }
    ]
    const result = applyImport(store, plan({ handled: [], sessions: [], seen }), 1_000)
    expect(result.seen).toEqual({ total: 2, present: 1, added: 1 })
    expect(store.seenTimes(ID)).toEqual(
      new Map([
        ['wt:a', 5],
        ['wt:b', 2]
      ])
    )
  })

  it('records an old tab as a finished imported run whose step the session check reads', () => {
    const { store } = setup()
    applyImport(store, plan({ handled: [] }), 1_000)
    expect(store.runs.get(importedRunId(ID, 'term_1'))).toMatchObject({
      automationId: ID,
      status: 'done',
      worktreePath: '/wt/usage',
      itemLabel: 'usage',
      imported: true
    })
    expect(store.runs.sessionStepsIn(ID, '/wt/usage', 0)).toMatchObject([
      {
        name: 'imported',
        agent: 'claude',
        status: 'done',
        terminalHandle: 'term_1',
        finishedAt: 1_000
      }
    ])
    // The old sweep's tokens aren't Pilot's spend: the imported step is never measured.
    expect(store.usage.unmeasuredSteps()).toEqual([])
  })

  it('marks the queue row of the card imported from a note, for the answer already sent, as dispatched', () => {
    const { store } = setup()
    store.inbox.add(card('i1', 'Items.md#abc'))
    store.inbox.saveAnswer(
      'i1',
      { option: null, text: 'ok', digest: 'd1', via: 'import' },
      'nish',
      2
    )
    const queued = store.queue.enqueue('i1', 5, 5)
    const dispatched = [
      { vaultRef: 'Items.md#abc', answer: 'ok' },
      { vaultRef: 'Items.md#abc', answer: 'something else' },
      { vaultRef: 'Items.md#missing', answer: 'ok' }
    ]
    const only = { handled: [], sessions: [], dispatched }
    const first = applyImport(store, plan(only), 9)
    expect(store.queue.get(queued)?.state).toBe('dispatched')
    expect(first.dispatched).toEqual({ total: 3, present: 0, added: 1 })
    expect(first.plan.notes).toEqual([
      '2 answer(s) already sent have no imported card to mark; import the open vault cards in Pilot (Inbox) first'
    ])
    expect(applyImport(store, plan(only), 10).dispatched).toEqual({
      total: 3,
      present: 1,
      added: 0
    })
  })

  it('copies a file only while its target is missing', () => {
    const { dir, store } = setup()
    const from = join(dir, 'usage.json')
    const to = join(dir, 'data', 'usage-legacy.json')
    writeFileSync(from, '{"rows": [1]}')
    const files = plan({ handled: [], sessions: [], files: [{ from, to }] })
    expect(applyImport(store, files, 1).files).toEqual({ total: 1, present: 0, added: 1 })
    writeFileSync(from, '{"rows": [2]}')
    expect(applyImport(store, files, 2).files).toEqual({ total: 1, present: 1, added: 0 })
    expect(readFileSync(to, 'utf8')).toBe('{"rows": [1]}')
  })
})
