import { describe, expect, it } from 'vitest'
import type { RunRow } from '../../shared/api-types'
import { PilotStore } from '../store/store'
import type { Pilotcli, PilotcliReply } from './pilotcli'
import { sweepEnvs } from './sweep'
import { createTeardowns } from './teardown'

type Seed = {
  id: string
  status: RunRow['status']
  path?: string
  removed?: boolean
  preparing?: boolean
  stuck?: boolean
}

function storeWith(runs: Seed[]) {
  const store = PilotStore.open(':memory:')
  for (const r of runs) {
    store.runs.create({
      id: r.id,
      automationId: 'ci',
      tickId: null,
      itemKey: r.id,
      itemLabel: r.id,
      worktreePath: '/wt',
      startedAt: 1
    })
    store.runs.envs.begin(r.id, '/wt', {})
    if (!r.preparing) {
      store.runs.envs.ready(r.id, {
        mode: 'throwaway',
        reason: '',
        path: r.path ?? `/agents/agents-${r.id.toLowerCase()}`,
        home: '/wt',
        worktreeId: 'id',
        sha: null,
        envFile: null,
        vars: {},
        stack: null
      })
    }
    store.runs.update(r.id, { status: r.status, finishedAt: 2 })
    if (r.removed) {
      store.runs.envs.removed(r.id, 3)
    }
    if (r.stuck) {
      store.runs.envs.deleteRefused(r.id, 'invalid run name')
    }
  }
  return store
}
// A row as env list gives it (Contract answers 4): `run` is the id exactly as passed to create; an orphan's is "".
const row = (run: string, over: Record<string, unknown> = {}) => ({
  run,
  name: `agents-${run.toLowerCase()}`,
  project: `agents-${run.toLowerCase()}`,
  mode: 'throwaway',
  status: 'ready',
  path: null,
  stack: null,
  created: '2026-10-13T10:00:00Z',
  age_hours: 2,
  orphan: false,
  stale: false,
  ...over
})
const list = (rows: unknown[]): PilotcliReply => ({
  outcome: 'ok',
  reason: '',
  data: rows,
  code: 0
})

function sweep(store: PilotStore, reply: PilotcliReply, preparingHere = false) {
  const started: string[] = []
  const report = sweepEnvs({
    store,
    pilotcli: async () => reply,
    teardown: (run) => started.push(run.id),
    isPreparing: () => preparingHere,
    now: () => 10,
    log: () => {}
  })
  return { started, report }
}

describe('the startup sweep', () => {
  it.each([
    [
      "an ended run of Pilot's: deleted",
      [{ id: 'ci-1', status: 'done' }],
      [row('ci-1', { path: '/agents/agents-ci-1' })],
      false,
      ['ci-1']
    ],
    [
      'the run id exactly, upper case and all',
      [{ id: 'CI_2', status: 'done' }],
      [row('CI_2')],
      false,
      ['CI_2']
    ],
    ['a sanitized id is not this run', [{ id: 'CI_2', status: 'done' }], [row('ci-2')], false, []],
    [
      'a folder name is not a run id',
      [{ id: 'ci-1', status: 'failed' }],
      [row('agents-ci-1')],
      false,
      []
    ],
    ['a run that still runs: left', [{ id: 'ci-1', status: 'running' }], [row('ci-1')], false, []],
    ['an unknown run: left', [{ id: 'ci-1', status: 'done' }], [row('someone-else')], false, []],
    [
      'an orphan, its run empty: left',
      [{ id: 'ci-1', status: 'done' }],
      [row('', { name: 'agents-ci-1', orphan: true })],
      false,
      []
    ],
    [
      'creating while this Pilot still prepares it: left',
      [{ id: 'ci-1', status: 'cancelled', preparing: true }],
      [row('ci-1', { status: 'creating' })],
      true,
      []
    ],
    [
      'creating, prepared by no one here: handed to teardown',
      [{ id: 'ci-1', status: 'cancelled', preparing: true }],
      [row('ci-1', { status: 'creating' })],
      false,
      ['ci-1']
    ],
    [
      'another folder than the one recorded: left',
      [{ id: 'ci-1', status: 'done', path: '/agents/agents-ci-1' }],
      [row('ci-1', { path: '/elsewhere/agents-ci-1' })],
      false,
      []
    ],
    [
      'recorded removed but still listed: deleted again',
      [{ id: 'ci-1', status: 'done', removed: true }],
      [row('ci-1')],
      false,
      ['ci-1']
    ],
    [
      'stuck (pilotcli refused its name): left',
      [{ id: 'ci-1', status: 'done', stuck: true }],
      [row('ci-1')],
      false,
      []
    ]
  ] as const)('%s', async (_name, runs, rows, preparingHere, deleted) => {
    const store = storeWith([...runs])
    const { started, report } = sweep(store, list([...rows]), preparingHere)
    expect((await report).deleted).toEqual(deleted)
    expect(started).toEqual(deleted)
  })

  it('an ended run whose env pilotcli no longer lists is recorded removed', async () => {
    const store = storeWith([{ id: 'ci-1', status: 'done' }])
    const { report } = sweep(store, list([]))
    expect((await report).removed).toEqual(['ci-1'])
    expect(store.runs.get('ci-1')?.env?.removedAt).toBe(10)
  })

  it.each([
    [
      'a run that ends while env list runs is left to its own teardown',
      'running' as const,
      (store: PilotStore) => store.runs.update('ci-1', { status: 'done', finishedAt: 5 }),
      null
    ],
    [
      'a run its own teardown recorded removed while env list ran keeps that record',
      'done' as const,
      (store: PilotStore) => store.runs.envs.removed('ci-1', 5),
      5
    ]
  ])('%s', async (_name, status, meanwhile, removedAt) => {
    const store = storeWith([{ id: 'ci-1', status }])
    const report = await sweepEnvs({
      store,
      pilotcli: async () => {
        meanwhile(store)
        return list([])
      },
      teardown: () => {},
      isPreparing: () => false,
      now: () => 10,
      log: () => {}
    })
    expect(report.removed).toEqual([])
    expect(store.runs.get('ci-1')?.env?.removedAt).toBe(removedAt)
  })

  it.each([
    [
      'env list failed',
      { outcome: 'failed', reason: 'boom', data: null, code: 1 } as PilotcliReply
    ],
    [
      'env list returned no list',
      { outcome: 'ok', reason: '', data: { envs: [] }, code: 0 } as PilotcliReply
    ]
  ])('%s: nothing is touched', async (_name, reply) => {
    const store = storeWith([{ id: 'ci-1', status: 'done' }])
    const { started, report } = sweep(store, reply)
    await report
    expect(started).toEqual([])
    expect(store.runs.get('ci-1')?.env?.removedAt).toBeNull()
  })

  // The real teardown: a reopened env is due like any other, so a delete that fails is retried with the usual backoff.
  it('an env it reopens whose delete fails is retried by housekeeping, a minute later', async () => {
    const store = storeWith([{ id: 'ci-1', status: 'done', removed: true }])
    let at = 10
    const deletes: number[] = []
    const replies: PilotcliReply[] = [
      { outcome: 'failed', reason: 'volume in use', data: null, code: 1 },
      { outcome: 'ok', reason: '', data: { removed: ['folder'] }, code: 0 }
    ]
    const pilotcli: Pilotcli = async (call) => {
      if (call.args[1] === 'list') {
        return list([row('ci-1')])
      }
      deletes.push(at)
      return replies.shift()!
    }
    const teardowns = createTeardowns({
      store,
      now: () => at,
      pilotcli,
      preparations: { stop: async () => {} },
      stopOrphanCreate: async () => {},
      tabs: { isOpen: async () => false, draft: async () => '', close: async () => {} },
      forget: () => {},
      log: () => {}
    })
    const swept = await sweepEnvs({
      store,
      pilotcli,
      teardown: (run) => teardowns.start(run),
      isPreparing: () => false,
      now: () => at,
      log: () => {}
    })
    await teardowns.settled()
    expect(swept.deleted).toEqual(['ci-1'])
    expect(store.runs.get('ci-1')?.env).toMatchObject({ removedAt: null, deleteAttempts: 1 })
    for (const later of [59_999, 60_000]) {
      at = 10 + later
      teardowns.housekeep()
      await teardowns.settled()
    }
    expect(deletes).toEqual([10, 60_010])
    expect(store.runs.get('ci-1')?.env).toMatchObject({ state: 'removed', removedAt: 60_010 })
  })
})
