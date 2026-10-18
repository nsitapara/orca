import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PilotStore } from '../store/store'
import {
  STALE_PENDING_MS,
  STALE_PENDING_OUTCOME,
  STALE_START_MS,
  STALE_START_OUTCOME,
  sweepStaleStarts
} from './stale-starts'

const MIN = 60_000

function newStore(): PilotStore {
  return PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-sweep-')), 'db.sqlite'))
}

// A run as startRuns leaves it: created, once_per key marked, step 'starting' until the terminal is up.
function startRun(store: PilotStore, runId: string, startedAt: number): void {
  store.runs.create({
    id: runId,
    automationId: 'a',
    tickId: null,
    itemKey: runId,
    itemLabel: runId,
    worktreePath: '/wt',
    startedAt
  })
  store.markHandled('a', `${runId}:1`, runId, startedAt)
  store.runs.createStep({ runId, idx: 0, name: 's', agent: 'claude', skill: null, startedAt })
}

describe('sweepStaleStarts', () => {
  it('fails a run whose agent never launched, counts a failure on its key, and leaves the rest', () => {
    const store = newStore()
    const now = 10 * MIN
    startRun(store, 'stuck', now - 3 * MIN)
    startRun(store, 'launching', now - 1 * MIN)
    startRun(store, 'launched', now - 3 * MIN)
    store.runs.updateStep('launched', 0, { status: 'running', terminalHandle: 't', paneKey: 'p' })
    const logs: string[] = []
    const counted: [string, number][] = []
    sweepStaleStarts(
      store,
      () => now,
      (m) => logs.push(m),
      { failureCounted: (run, failures) => counted.push([run.id, failures]) }
    )
    expect(store.runs.get('stuck')).toMatchObject({
      status: 'failed',
      outcome: STALE_START_OUTCOME,
      finishedAt: now
    })
    expect(store.runs.steps('stuck')[0]).toMatchObject({
      status: 'failed',
      error: STALE_START_OUTCOME,
      finishedAt: now
    })
    expect(store.handledRows('a').map((r) => [r.onceKey, r.status, r.failures])).toEqual([
      ['launched:1', 'started', 0],
      ['launching:1', 'started', 0],
      ['stuck:1', 'failed', 1]
    ])
    expect(counted).toEqual([['stuck', 1]])
    expect(store.runs.get('launching')?.status).toBe('running')
    expect(store.runs.get('launched')?.status).toBe('running')
    expect(logs).toEqual([`[pilot] run stuck: ${STALE_START_OUTCOME}`])
  })

  it("frees an ask-first job's key, counting no failure, so its item is asked again", () => {
    const store = newStore()
    const now = 10 * MIN
    startRun(store, 'asked', now - 3 * MIN)
    store.runs.create({
      id: 'bare',
      automationId: 'a',
      tickId: null,
      itemKey: 'bare',
      itemLabel: 'bare',
      worktreePath: '/wt',
      startedAt: now - 3 * MIN
    })
    store.markHandled('a', 'bare:1', 'bare', now - 3 * MIN)
    const counted: string[] = []
    sweepStaleStarts(
      store,
      () => now,
      () => {},
      { asksFirst: (id) => id === 'a', failureCounted: (run) => counted.push(run.id) }
    )
    expect(['asked', 'bare'].map((id) => store.runs.get(id)?.status)).toEqual(['failed', 'failed'])
    expect(store.handledRows('a')).toEqual([])
    expect(counted).toEqual([])
  })

  it("closes the step but keeps a run's own outcome when the run already ended", () => {
    const store = newStore()
    startRun(store, 'r', 0)
    store.runs.update('r', {
      status: 'failed',
      outcome: "Couldn't start: worktree is gone",
      finishedAt: 5
    })
    sweepStaleStarts(
      store,
      () => 10 * MIN,
      () => {}
    )
    expect(store.runs.get('r')).toMatchObject({
      outcome: "Couldn't start: worktree is gone",
      finishedAt: 5
    })
    expect(store.runs.steps('r')[0].status).toBe('failed')
  })

  it('fails a run that never got a step and counts a failure on its key, once it is older than the cutoff', () => {
    const store = newStore()
    const now = 10 * MIN
    for (const [id, startedAt] of [
      ['bare', now - 3 * MIN],
      ['fresh', now - 1 * MIN]
    ] as const) {
      store.runs.create({
        id,
        automationId: 'a',
        tickId: null,
        itemKey: id,
        itemLabel: id,
        worktreePath: '/wt',
        startedAt
      })
      store.markHandled('a', `${id}:1`, id, startedAt)
    }
    const logs: string[] = []
    sweepStaleStarts(
      store,
      () => now,
      (m) => logs.push(m)
    )
    expect(store.runs.get('bare')).toMatchObject({
      status: 'failed',
      outcome: STALE_START_OUTCOME,
      finishedAt: now
    })
    expect(store.runs.get('fresh')?.status).toBe('running')
    expect(store.handledRows('a').map((r) => [r.onceKey, r.status, r.failures])).toEqual([
      ['bare:1', 'failed', 1],
      ['fresh:1', 'started', 0]
    ])
    expect(logs).toEqual([`[pilot] run bare: ${STALE_START_OUTCOME}`])
  })

  it('never throws: a broken store is logged', () => {
    const store = newStore()
    store.close()
    const logs: string[] = []
    expect(() =>
      sweepStaleStarts(
        store,
        () => 0,
        (m) => logs.push(m)
      )
    ).not.toThrow()
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatch(/^\[pilot\] couldn't sweep stale starts: /)
  })

  it('fails only a later step stuck starting: the run keeps its key, and the run engine ends it', () => {
    const store = newStore()
    startRun(store, 'multi', 0)
    store.runs.updateStep('multi', 0, {
      status: 'done',
      terminalHandle: 't',
      paneKey: 'p',
      finishedAt: 1
    })
    store.runs.createStep({
      runId: 'multi',
      idx: 1,
      name: 'fix',
      agent: 'claude',
      skill: null,
      startedAt: 2
    })
    sweepStaleStarts(
      store,
      () => 10 * MIN,
      () => {}
    )
    expect(store.runs.steps('multi')[1]).toMatchObject({
      status: 'failed',
      error: STALE_START_OUTCOME
    })
    expect(store.runs.get('multi')?.status).toBe('running')
    expect(store.handledKeys('a')).toEqual(new Set(['multi:1']))
  })

  it('never fails a step still pending (its workspace is being made): the run keeps its key', () => {
    const store = newStore()
    store.runs.create({
      id: 'slow',
      automationId: 'a',
      tickId: null,
      itemKey: 'slow',
      itemLabel: 'slow',
      worktreePath: null,
      startedAt: 0
    })
    store.markHandled('a', 'slow:1', 'slow', 0)
    store.runs.createStep({
      runId: 'slow',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      status: 'pending',
      startedAt: 0
    })
    sweepStaleStarts(
      store,
      () => 10 * MIN,
      () => {}
    )
    expect(store.runs.steps('slow')[0].status).toBe('pending')
    expect(store.runs.get('slow')?.status).toBe('running')
    expect(store.handledKeys('a')).toEqual(new Set(['slow:1']))
  })

  it('fails a step left pending past the bound by an app that stopped while making its workspace', () => {
    const store = newStore()
    store.runs.create({
      id: 'left',
      automationId: 'a',
      tickId: null,
      itemKey: 'left',
      itemLabel: 'left',
      worktreePath: null,
      startedAt: 0
    })
    store.markHandled('a', 'left:1', 'left', 0)
    store.runs.createStep({
      runId: 'left',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      status: 'pending',
      startedAt: null
    })
    sweepStaleStarts(
      store,
      () => STALE_PENDING_MS + 1,
      () => {}
    )
    expect(store.runs.steps('left')[0]).toMatchObject({
      status: 'failed',
      error: STALE_PENDING_OUTCOME
    })
    expect(store.runs.get('left')).toMatchObject({
      status: 'failed',
      outcome: STALE_PENDING_OUTCOME
    })
    expect(store.handledRows('a')).toMatchObject([
      { onceKey: 'left:1', status: 'failed', failures: 1 }
    ])
  })

  it('never fails a pending step whose workspace this process is still making, however long it takes', () => {
    const store = newStore()
    store.runs.create({
      id: 'slow',
      automationId: 'a',
      tickId: null,
      itemKey: 'slow',
      itemLabel: 'slow',
      worktreePath: null,
      startedAt: 0
    })
    store.markHandled('a', 'slow:1', 'slow', 0)
    store.runs.createStep({
      runId: 'slow',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      status: 'pending',
      startedAt: 0
    })
    sweepStaleStarts(
      store,
      () => 2 * STALE_PENDING_MS,
      () => {},
      { olderThanMs: STALE_START_MS, opening: (runId) => runId === 'slow' }
    )
    expect(store.runs.steps('slow')[0].status).toBe('pending')
    expect(store.runs.get('slow')?.status).toBe('running')
    expect(store.handledKeys('a')).toEqual(new Set(['slow:1']))
  })

  it('puts the handed-over ids a stale run took back to pending, whether it had a step or not', () => {
    const store = newStore()
    const now = 10 * MIN
    startRun(store, 'stuck', now - 3 * MIN)
    store.runs.create({
      id: 'stepless',
      automationId: 'a',
      tickId: null,
      itemKey: 's',
      itemLabel: 's',
      worktreePath: '/wt',
      startedAt: now - 20 * MIN
    })
    store.handovers.add({
      senderId: 'open',
      senderRunId: 'r0',
      receiverId: 'a',
      itemIds: ['WEB-1', 'WEB-2'],
      at: now - 5 * MIN
    })
    const [one, two] = store.handovers.pending('a', 10)
    store.handovers.consume(1, now - 3 * MIN, [
      { rowId: one.id, verdict: 'started', reason: 'Started', runId: 'stuck' },
      { rowId: two.id, verdict: 'started', reason: 'Started', runId: 'stepless' }
    ])
    sweepStaleStarts(
      store,
      () => now,
      () => {}
    )
    expect(store.runs.get('stuck')?.status).toBe('failed')
    expect(store.runs.get('stepless')?.status).toBe('failed')
    expect(store.handovers.pending('a', 10).map((h) => h.itemId)).toEqual(['WEB-1', 'WEB-2'])
  })
})
