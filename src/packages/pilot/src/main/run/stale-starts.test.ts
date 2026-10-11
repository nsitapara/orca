import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PilotStore } from '../store/store'
import { STALE_START_OUTCOME, sweepStaleStarts } from './stale-starts'

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
  it('fails a run whose agent never launched, frees its once_per key, and leaves the rest', () => {
    const store = newStore()
    const now = 10 * MIN
    startRun(store, 'stuck', now - 3 * MIN)
    startRun(store, 'launching', now - 1 * MIN)
    startRun(store, 'launched', now - 3 * MIN)
    store.runs.updateStep('launched', 0, { status: 'running', terminalHandle: 't', paneKey: 'p' })
    const logs: string[] = []
    sweepStaleStarts(
      store,
      () => now,
      (m) => logs.push(m)
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
    expect(store.handledKeys('a')).toEqual(new Set(['launching:1', 'launched:1']))
    expect(store.runs.get('launching')?.status).toBe('running')
    expect(store.runs.get('launched')?.status).toBe('running')
    expect(logs).toEqual([`[pilot] run stuck: ${STALE_START_OUTCOME}`])
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

  it('fails a run that never got a step and frees its key, once it is older than the cutoff', () => {
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
    expect(store.handledKeys('a')).toEqual(new Set(['fresh:1']))
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
})
