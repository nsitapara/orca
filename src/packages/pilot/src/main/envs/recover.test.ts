import { describe, expect, it } from 'vitest'
import { PilotStore } from '../store/store'
import { STOPPED } from './prepare'
import { RECOVERED_OUTCOME, recoverPreparing, type RecoverDeps } from './recover'

function setup(status: 'running' | 'failed', settled: string | null = null) {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'r1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt/a',
    startedAt: 1,
    status
  })
  store.runs.createStep({
    runId: 'r1',
    idx: 0,
    name: 'fix',
    agent: 'shell',
    skill: null,
    startedAt: 1,
    status: 'pending',
    kind: 'shell'
  })
  store.markHandled('ci', '1', 'r1', 1)
  store.runs.envs.begin('r1', '/wt/a', {
    args: [],
    preparer: { pid: 4242, identity: 'Mon Oct 13 09:00:00 2026' }
  })
  if (settled !== null) {
    store.runs.envs.settle('r1', 'failed', settled)
  }
  return store
}

function deps(store: PilotStore, over: Partial<RecoverDeps> = {}) {
  const stopped: string[] = []
  const closed: string[] = []
  const recover: RecoverDeps = {
    store,
    now: () => 100,
    isPreparing: () => false,
    preparerGone: () => true,
    stopOrphanCreate: async (runId) => {
      stopped.push(runId)
    },
    close: (run, end, opts) => {
      closed.push(run.id)
      store.runs.update(run.id, { status: end.status, outcome: end.outcome, finishedAt: 100 })
      if (opts.release) {
        store.unmarkHandledForRun(run.automationId, run.id)
      }
    },
    log: () => {},
    ...over
  }
  return { recover, stopped, closed }
}

describe('recoverPreparing', () => {
  it.each([
    [
      'a stopped Pilot left it: closed, its create stopped, key freed',
      'running',
      null,
      true,
      false,
      { status: 'failed', outcome: RECOVERED_OUTCOME },
      ['r1'],
      true
    ],
    [
      'a quit settled it stopped but left its run running: closed, its create stopped, key freed',
      'running',
      STOPPED,
      true,
      false,
      { status: 'failed', outcome: RECOVERED_OUTCOME },
      ['r1'],
      true
    ],
    [
      'this process still prepares it',
      'running',
      null,
      true,
      true,
      { status: 'running' },
      [],
      false
    ],
    [
      'another live Pilot prepares it',
      'running',
      null,
      false,
      false,
      { status: 'running' },
      [],
      false
    ],
    [
      'its run already ended (the stale sweep): only its create is stopped',
      'failed',
      null,
      true,
      false,
      { status: 'failed' },
      ['r1'],
      false
    ],
    [
      'a run that ended after its create was stopped (a cancel): left to its teardown',
      'failed',
      STOPPED,
      true,
      false,
      { status: 'failed' },
      [],
      false
    ],
    [
      'a create that failed on its own: left as it is',
      'running',
      'bad flags',
      true,
      false,
      { status: 'running' },
      [],
      false
    ]
  ] as const)(
    '%s',
    async (_name, status, settled, gone, inFlight, runAfter, stoppedCreates, keyFreed) => {
      const store = setup(status, settled)
      const t = deps(store, { isPreparing: () => inFlight, preparerGone: () => gone })
      await recoverPreparing(t.recover)
      expect(store.runs.get('r1')).toMatchObject(runAfter)
      expect(t.stopped).toEqual(stoppedCreates)
      expect(store.handledRows('ci')).toHaveLength(keyFreed ? 0 : 1)
      if (stoppedCreates.length > 0) {
        expect(store.runs.get('r1')?.env).toMatchObject({
          state: 'failed',
          reason: RECOVERED_OUTCOME
        })
      }
      const step = store.runs.steps('r1')[0]
      expect(step.status).toBe(keyFreed ? 'failed' : 'pending')
    }
  )

  // Ruling P13: the run is read again after its create was stopped, so a run something else closed meanwhile (the stale
  // sweep, a cancel) is never closed twice.
  it('a run something else closed while its create was stopped is not closed again', async () => {
    const store = setup('running')
    const t = deps(store, {
      stopOrphanCreate: async () => {
        store.runs.update('r1', { status: 'cancelled', outcome: 'Cancelled', finishedAt: 50 })
      }
    })
    await recoverPreparing(t.recover)
    expect(t.closed).toEqual([])
    expect(store.runs.get('r1')).toMatchObject({ status: 'cancelled', outcome: 'Cancelled' })
    expect(store.runs.steps('r1')[0].status).toBe('pending')
  })

  // One recovery's failure never stops the others, and step 0 fails only once its run is closed: a close that throws
  // leaves the run running with step 0 pending, for the stale-start sweep (STALE_PENDING_MS).
  it('a recovery that throws is logged and the next one still runs; a failed close leaves step 0 pending', async () => {
    const store = setup('running')
    store.runs.create({
      id: 'r2',
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:2',
      itemLabel: '!2',
      worktreePath: '/wt/b',
      startedAt: 2
    })
    store.runs.envs.begin('r2', '/wt/b', { args: [], preparer: { pid: 4243, identity: null } })
    const logs: string[] = []
    const t = deps(store, {
      close: (run) => {
        if (run.id === 'r1') {
          throw new Error('store busy')
        }
        store.runs.update(run.id, { status: 'failed', outcome: RECOVERED_OUTCOME, finishedAt: 100 })
      },
      log: (m) => void logs.push(m)
    })
    await expect(recoverPreparing(t.recover)).resolves.toBe(1)
    expect(store.runs.get('r1')?.status).toBe('running')
    expect(store.runs.steps('r1')[0].status).toBe('pending')
    expect(store.runs.get('r2')?.status).toBe('failed')
    expect(logs).toContain("[pilot] run r1: couldn't recover its workspace: store busy")
  })
})
