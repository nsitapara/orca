import { describe, expect, it } from 'vitest'
import type { EnvMode, StrandedWork } from '../../shared/api-types-env'
import type { EnvWorkspaceDef } from '../../shared/definition/types'
import { closeRun } from '../run/run-close'
import { PilotStore } from '../store/store'
import type { Pilotcli, PilotcliCall, PilotcliReply } from './pilotcli'
import { createPreparations, STOPPED } from './prepare'
import { createTeardowns, type TeardownDeps } from './teardown'

const OK: PilotcliReply = { outcome: 'ok', reason: '', data: { removed: ['folder'] }, code: 0 }

function setup(
  mode: EnvMode,
  replies: PilotcliReply[],
  opts: {
    status?: 'done' | 'running'
    drafts?: Record<string, string>
    // What each failed try finds left in the throwaway, in order (main/envs/stranded.ts).
    stranded?: (StrandedWork | null)[]
  } = {}
) {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'r1',
    automationId: 'ci',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt/a',
    startedAt: 1
  })
  store.runs.envs.begin('r1', '/wt/a', {})
  store.runs.envs.ready('r1', {
    mode,
    reason: '',
    path: mode === 'in_place' ? '/wt/a' : '/agents/agents-r1',
    home: '/wt/a',
    worktreeId: 'id',
    sha: null,
    envFile: null,
    vars: {},
    stack: null
  })
  for (const [idx, handle] of ['t1', 't1', 't2'].entries()) {
    store.runs.createStep({
      runId: 'r1',
      idx,
      name: `s${idx}`,
      agent: 'claude',
      skill: null,
      startedAt: 2
    })
    store.runs.updateStep('r1', idx, { status: 'done', terminalHandle: handle, finishedAt: 3 })
  }
  store.runs.update('r1', { status: opts.status ?? 'done', finishedAt: 4 })
  const calls: PilotcliCall[] = []
  const closed: string[] = []
  const order: string[] = []
  const kept: string[] = []
  const raised: [string, StrandedWork, string][] = []
  const cardsClosed: [string, string][] = []
  const reads = opts.stranded
  const teardowns = createTeardowns({
    store,
    now: () => 1000,
    pilotcli: async (call) => {
      calls.push(call)
      order.push(call.args.slice(0, 2).join(' '))
      return replies.shift() ?? OK
    },
    preparations: {
      stop: async () => {
        order.push('stop')
      }
    },
    stopOrphanCreate: async (runId) => {
      order.push(`stop orphan ${runId}`)
    },
    tabs: {
      isOpen: async () => true,
      draft: async (h) => opts.drafts?.[h] ?? '',
      close: async (h) => {
        closed.push(h)
      }
    },
    forget: () => {},
    kept: (run) => {
      kept.push(run.id)
    },
    ...(reads
      ? {
          stranded: {
            read: async () => reads.shift() ?? null,
            raise: (run, work, reason) => {
              raised.push([run.id, work, reason])
              return 'card-1'
            },
            close: (cardId, outcome) => {
              cardsClosed.push([cardId, outcome])
            }
          }
        }
      : {}),
    log: () => {}
  })
  const env = () => store.runs.get('r1')?.env
  return { store, calls, closed, order, kept, raised, cardsClosed, teardowns, env }
}

async function tearDown(t: ReturnType<typeof setup>): Promise<void> {
  t.teardowns.start(t.store.runs.get('r1')!)
  await t.teardowns.settled()
}

// The keep step failed on every web-platform throwaway for a day (2026-10-22): the folders stayed, nothing reached a
// pilot/ branch, and the runs read Done. A throwaway that holds work nothing else has is loud instead.
describe("a throwaway Pilot can't remove that holds work nothing else has", () => {
  const WHY = "couldn't keep its uncommitted edits: git add failed (exit 1)"
  const FAIL: PilotcliReply = { outcome: 'failed', reason: WHY, data: null, code: 1 }
  const WORK: StrandedWork = { commits: ['a46c16a5a5ec89a766df771a1e91b9d62101073a'], edits: 0 }

  it('raises its card on every failed try, records the work on the run, and closes the card once it is removed', async () => {
    const kept = { ...OK, data: { removed: ['folder'], kept: 'pilot/r1' } }
    const t = setup('throwaway', [FAIL, FAIL, kept], { stranded: [WORK, WORK] })
    await tearDown(t)
    expect(t.raised).toEqual([['r1', WORK, WHY]])
    expect(t.env()).toMatchObject({ removedAt: null, stranded: { ...WORK, cardId: 'card-1' } })
    await tearDown(t)
    expect(t.raised).toHaveLength(2)
    expect(t.cardsClosed).toEqual([])
    await tearDown(t)
    expect(t.cardsClosed).toEqual([
      ['card-1', 'Removed its throwaway; its work is kept on pilot/r1 for job 15 to merge home']
    ])
    expect(t.env()).toMatchObject({ state: 'removed', kept: 'pilot/r1' })
    expect(t.env()?.stranded).toBeUndefined()
  })

  it('raises nothing while it holds nothing, and closes the card once it holds nothing now', async () => {
    const t = setup('throwaway', [FAIL, FAIL, FAIL], { stranded: [null, WORK, null] })
    await tearDown(t)
    expect(t.raised).toEqual([])
    expect(t.env()?.stranded).toBeUndefined()
    await tearDown(t)
    await tearDown(t)
    expect(t.raised).toHaveLength(1)
    expect(t.cardsClosed).toEqual([['card-1', "Its throwaway holds nothing that isn't home now"]])
    expect(t.env()?.stranded).toBeUndefined()
  })

  it.each(['kept', 'in_place'] as const)('never looks in a %s env', async (mode) => {
    const t = setup(mode, [FAIL], { stranded: [WORK] })
    await tearDown(t)
    expect(t.raised).toEqual([])
    expect(t.env()?.stranded).toBeUndefined()
  })
})

describe('teardown at run end', () => {
  it.each([
    [
      'a throwaway: its tabs close, then it is deleted',
      'throwaway',
      ['t1', 't2'],
      ['env', 'delete', 'r1', '--format', 'json']
    ],
    [
      'kept: tabs stay, the folder stays',
      'kept',
      [],
      ['env', 'delete', 'r1', '--keep-folder', 'true', '--format', 'json']
    ],
    [
      'in place: tabs stay, the record goes',
      'in_place',
      [],
      ['env', 'delete', 'r1', '--format', 'json']
    ]
  ] as const)('%s', async (_name, mode, closedTabs, args) => {
    const t = setup(mode, [OK])
    t.teardowns.start(t.store.runs.get('r1')!)
    await t.teardowns.settled()
    expect(t.closed).toEqual(closedTabs)
    expect(t.calls.map((c) => c.args)).toEqual([args])
    expect(t.env()).toMatchObject({ state: 'removed', removedAt: 1000 })
  })

  it.each<[string, unknown, string | undefined]>([
    [
      'the branch env delete kept the commits on',
      { removed: ['folder'], kept: 'pilot/r1' },
      'pilot/r1'
    ],
    ['none from an older pilotcli', { removed: ['folder'] }, undefined],
    ['none for an empty name', { removed: ['folder'], kept: '' }, undefined]
  ])(
    "records with a throwaway's env %s, and brings a kept branch home",
    async (_name, data, kept) => {
      const t = setup('throwaway', [{ ...OK, data }])
      t.teardowns.start(t.store.runs.get('r1')!)
      await t.teardowns.settled()
      expect(t.env()?.kept).toBe(kept)
      expect(t.kept).toEqual(kept ? ['r1'] : [])
    }
  )

  // r1 is an answer run that typed its answers into the asking run's tab t2 (a resumed session): t2 is borrowed, never its
  // own, so its teardown leaves it open whatever env the answer run got.
  it.each([
    ['in place: no tab closes', 'in_place', []],
    ['a throwaway: only its own tab closes', 'throwaway', ['t1']]
  ] as const)(
    'an answer run that resumed the asking session: %s',
    async (_name, mode, closedTabs) => {
      const t = setup(mode, [OK])
      t.store.runs.create({
        id: 'asking',
        automationId: 'ci',
        tickId: null,
        itemKey: 'mr:1',
        itemLabel: '!1',
        worktreePath: '/wt/a',
        startedAt: 0
      })
      t.store.runs.createStep({
        runId: 'asking',
        idx: 0,
        name: 'fix',
        agent: 'claude',
        skill: null,
        startedAt: 0
      })
      t.store.runs.updateStep('asking', 0, { status: 'done', terminalHandle: 't2', finishedAt: 1 })
      t.store.runs.update('asking', { status: 'needs_you', finishedAt: 1 })
      t.teardowns.start(t.store.runs.get('r1')!)
      await t.teardowns.settled()
      expect(t.closed).toEqual(closedTabs)
      expect(t.env()).toMatchObject({ state: 'removed' })
    }
  )

  it('stops a create still in flight first, then deletes', async () => {
    const t = setup('throwaway', [OK])
    t.teardowns.start(t.store.runs.get('r1')!)
    await t.teardowns.settled()
    expect(t.order).toEqual(['stop', 'env delete'])
  })

  it('a tab with text typed in it stays open and the delete waits', async () => {
    const t = setup('throwaway', [], { drafts: { t2: 'wait, one more thing' } })
    t.teardowns.start(t.store.runs.get('r1')!)
    await t.teardowns.settled()
    expect(t.calls).toEqual([])
    expect(t.env()).toMatchObject({
      deleteError: 'someone is typing in terminal t2',
      deleteAttempts: 1,
      removedAt: null
    })
  })

  it.each([
    [
      'a repeat delete: ok with removed: [] is removed',
      { outcome: 'ok', reason: '', data: { removed: [] }, code: 0 },
      { state: 'removed', removedAt: 1000, deleteError: null, deleteAttempts: 0 },
      null,
      [],
      ['stop', 'env delete']
    ],
    [
      'failed: one try counted, retried in a minute',
      {
        outcome: 'failed',
        reason: 'docker compose down failed: volume in use',
        data: null,
        code: 1
      },
      {
        state: 'ready',
        removedAt: null,
        deleteError: 'docker compose down failed: volume in use',
        deleteAttempts: 1
      },
      61_000,
      ['env_delete_failed'],
      ['stop', 'env delete']
    ],
    [
      'not_yet: its create is stopped, tried again in 15 s, no try counted',
      { outcome: 'not_yet', reason: 'create for r1 is still running', data: null, code: 5 },
      {
        state: 'ready',
        removedAt: null,
        deleteError: 'create for r1 is still running',
        deleteAttempts: 0
      },
      16_000,
      [],
      ['stop', 'env delete', 'stop orphan r1']
    ],
    [
      'invalid: stuck, shown, never tried again',
      { outcome: 'invalid', reason: 'invalid run name "r1/.."', data: null, code: 2 },
      {
        state: 'stuck',
        removedAt: null,
        deleteError: 'invalid run name "r1/.."',
        deleteAttempts: 0
      },
      null,
      ['env_delete_refused'],
      ['stop', 'env delete']
    ]
  ] as const)('%s', async (_name, reply, env, dueAt, events, order) => {
    const t = setup('in_place', [reply])
    t.teardowns.start(t.store.runs.get('r1')!)
    await t.teardowns.settled()
    expect(t.env()).toMatchObject(env)
    expect(t.order).toEqual(order)
    expect(
      t.store.events
        .forRun('r1')
        .map((e) => e.kind)
        .filter((k) => k.startsWith('env_'))
    ).toEqual(events)
    if (dueAt === null) {
      expect(t.store.runs.envs.dueForTeardown(Number.MAX_SAFE_INTEGER)).toEqual([])
    } else {
      expect(t.store.runs.envs.dueForTeardown(dueAt - 1)).toEqual([])
      expect(t.store.runs.envs.dueForTeardown(dueAt).map((r) => r.id)).toEqual(['r1'])
    }
  })

  it('a delete that keeps failing is never run twice at once', async () => {
    const failing: PilotcliReply = { outcome: 'failed', reason: 'busy', data: null, code: 1 }
    const t = setup('in_place', [failing, failing])
    t.teardowns.housekeep()
    t.teardowns.housekeep()
    await t.teardowns.settled()
    expect(t.calls).toHaveLength(1)
  })

  it('leaves a run that still runs alone, its create included', async () => {
    const t = setup('throwaway', [], { status: 'running' })
    t.teardowns.start(t.store.runs.get('r1')!)
    await t.teardowns.settled()
    expect(t.order).toEqual([])
  })
})

const ENV: EnvWorkspaceDef = {
  kind: 'env',
  subject: { kind: 'worktree', worktree: '{worktree.path}', at: null },
  writes: true,
  stack: 'when_backend'
}

// M4 §8: a cancel during create kills its process group, then runs env delete. The real preparation, so the create has
// exited before the delete starts, and the run's steps never start.
describe('a run that ends while its env is made', () => {
  it('stops the create, waits for it to exit, then deletes; no step starts', async () => {
    const store = PilotStore.open(':memory:')
    store.runs.create({
      id: 'r1',
      automationId: 'ci',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 1
    })
    const order: string[] = []
    const pilotcli: Pilotcli = async (call) => {
      order.push(call.args.slice(0, 2).join(' '))
      if (call.args[1] !== 'create') {
        return OK
      }
      await new Promise((resolve) => call.signal?.addEventListener('abort', resolve))
      order.push('create exited')
      return { outcome: 'failed', reason: 'stopped by a signal', data: null, code: null }
    }
    const preparations = createPreparations({
      runs: store.runs,
      pilotcli,
      resolvePath: async () => {
        throw new Error('never reached')
      },
      nameOf: (id) => id,
      pidFile: (runId) => `/nowhere/${runId}.pid`,
      preparer: () => ({ pid: 1, identity: null }),
      nestThrowaway: async () => {},
      log: () => {}
    })
    let stepsStarted = 0
    const fields = { 'worktree.path': '/wt/a', 'run.id': 'r1' }
    const run = store.runs.get('r1')!
    preparations.begin(
      { run, env: ENV, repo: 'web-platform', label: '!1', fields },
      {
        ready: async () => {
          stepsStarted += 1
        },
        end: () => {}
      }
    )
    const deps: TeardownDeps = {
      store,
      now: () => 1000,
      pilotcli,
      preparations,
      stopOrphanCreate: async () => {},
      tabs: { isOpen: async () => true, draft: async () => '', close: async () => {} },
      forget: () => {},
      log: () => {}
    }
    const teardowns = createTeardowns(deps)
    const onRunEnd = (ended: typeof run) => teardowns.start(ended)
    closeRun({ store, now: () => 900, log: () => {}, onRunEnd }, run, {
      status: 'cancelled',
      outcome: 'Cancelled'
    })
    await teardowns.settled()
    expect(order).toEqual(['env create', 'create exited', 'env delete'])
    expect(stepsStarted).toBe(0)
    expect(preparations.isPreparing('r1')).toBe(false)
    expect(store.runs.get('r1')?.env).toMatchObject({
      state: 'removed',
      reason: STOPPED,
      removedAt: 1000
    })
  })
})
