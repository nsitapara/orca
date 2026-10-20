import { describe, expect, it } from 'vitest'
import type { ItemDecision } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { PreparedHooks } from '../envs/prepare'
import { PilotStore } from '../store/store'
import { createRunEngine, type StepStartRequest } from './advance'
import type { WorkspaceDeps } from './workspace'

const parsed = parseAutomationYaml(
  'name: Fix CI\nrepo: web-platform\nschedule: manual\nitems: { kind: merge_request }\nonce_per: "{mr.iid}"\n' +
    'workspace: { env: { worktree: "{worktree.path}", writes: true } }\nsteps:\n  - { name: fix, agent: shell, run: ./fix.sh }\n',
  '/a/ci.yaml'
)
if (!parsed.ok) {
  throw new Error(parsed.errors.join('\n'))
}
const DEF = parsed.definition
const DECISION: ItemDecision = {
  key: 'mr:1',
  label: '!1',
  verdict: 'started',
  reason: '',
  checks: [],
  onceKey: '1',
  fields: { 'mr.iid': 1, 'worktree.path': '/wt/a' }
}
const NO_WORKSPACE: WorkspaceDeps = {
  listWorktrees: async () => [],
  createWorktree: async () => {
    throw new Error('not expected')
  },
  claimWorktree: () => {
    throw new Error('not expected')
  }
}

function setup(
  startStep: (req: StepStartRequest) => Promise<void> = async () => {},
  failBegin: string | null = null
) {
  const store = PilotStore.open(':memory:')
  const clock = { now: 1000 }
  const started: StepStartRequest[] = []
  const box: { hooks: PreparedHooks | null } = { hooks: null }
  const engine = createRunEngine({
    store,
    now: () => clock.now,
    definitionFor: () => DEF,
    startStep: async (req) => {
      started.push(req)
      await startStep(req)
      store.runs.updateStep(req.run.id, req.idx, { status: 'running' })
    },
    workspace: NO_WORKSPACE,
    log: () => {},
    closeTerminal: async () => {},
    relist: async () => false,
    envs: {
      begin: (_req, hooks) => {
        if (failBegin) {
          throw new Error(failBegin)
        }
        box.hooks = hooks
      },
      isPreparing: () => box.hooks !== null
    }
  })
  store.runs.create({
    id: 'r1',
    automationId: DEF.id,
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: null,
    startedAt: 1000
  })
  store.markHandled(DEF.id, '1', 'r1', 1000)
  return { store, clock, started, engine, box }
}

describe('a run whose workspace is an env', () => {
  it('startRun returns while the env is being made, with step 0 pending', async () => {
    const t = setup()
    await t.engine.startRun({ runId: 'r1', definition: DEF, decision: DECISION })
    expect(t.store.runs.steps('r1')).toMatchObject([{ idx: 0, status: 'pending' }])
    expect(t.started).toEqual([])
  })

  it('once ready, the first step starts in the env folder and its time counts from then', async () => {
    const t = setup()
    await t.engine.startRun({ runId: 'r1', definition: DEF, decision: DECISION })
    t.store.runs.update('r1', { worktreePath: '/agents/agents-r1' })
    t.clock.now = 9000
    await t.box.hooks?.ready()
    expect(t.started[0].run.worktreePath).toBe('/agents/agents-r1')
    expect(t.store.runs.steps('r1')[0].startedAt).toBe(9000)
  })

  it("a first step that can't start after its env fails the run and frees its key", async () => {
    const t = setup(async () => {
      throw new Error('boom')
    })
    await t.engine.startRun({ runId: 'r1', definition: DEF, decision: DECISION })
    await t.box.hooks?.ready()
    expect(t.store.runs.get('r1')).toMatchObject({
      status: 'failed',
      outcome: "Couldn't start: boom"
    })
    expect(t.store.handledRows(DEF.id)).toEqual([])
  })

  it('deferred: cancelled, key freed, step 0 skipped, handed-over ids pending again', async () => {
    const t = setup()
    t.store.handovers.add({
      senderId: 'up',
      senderRunId: 'up-1',
      receiverId: DEF.id,
      itemIds: ['WEB-1'],
      at: 1
    })
    const [row] = t.store.handovers.pending(DEF.id, 10)
    t.store.handovers.consume(7, 2, [
      { rowId: row.id, verdict: 'started', reason: 'All checks pass', runId: 'r1' }
    ])
    await t.engine.startRun({ runId: 'r1', definition: DEF, decision: DECISION })
    t.box.hooks?.end({ status: 'cancelled', outcome: 'Deferred: cap' }, { release: true })
    expect(t.store.runs.get('r1')).toMatchObject({ status: 'cancelled', outcome: 'Deferred: cap' })
    expect(t.store.runs.steps('r1')[0]).toMatchObject({ status: 'skipped', error: 'Deferred: cap' })
    expect(t.store.handledRows(DEF.id)).toEqual([])
    expect(t.store.handovers.pending(DEF.id, 10).map((h) => h.itemId)).toEqual(['WEB-1'])
  })

  it('failed create: failed, its key failed for retry_after_failure, step 0 failed', async () => {
    const t = setup()
    await t.engine.startRun({ runId: 'r1', definition: DEF, decision: DECISION })
    t.box.hooks?.end(
      { status: 'failed', outcome: "Couldn't prepare its workspace: git failed" },
      {}
    )
    expect(t.store.runs.get('r1')?.status).toBe('failed')
    expect(t.store.handledRows(DEF.id)[0].status).toBe('failed')
    expect(t.store.runs.steps('r1')[0]).toMatchObject({
      status: 'failed',
      error: "Couldn't prepare its workspace: git failed"
    })
  })

  // Ruling P1: through the run's normal end, not the tick's "Couldn't start" (which frees the key every tick), so
  // retry_after_failure spaces the retries. Nothing was claimed or made, and no step started.
  it.each([
    [
      'a stack that resolves to no stack',
      "stack resolved to 'huge', expected never|backend|full|when_backend"
    ],
    [
      'a subject field with no value',
      "Can't prepare the workspace for !1: {worktree.path} has no value"
    ]
  ])(
    '%s fails the run with the reason: step 0 failed, its key failed for retry_after_failure',
    async (_name, reason) => {
      const t = setup(async () => {}, reason)
      await t.engine.startRun({ runId: 'r1', definition: DEF, decision: DECISION })
      expect(t.store.runs.get('r1')).toMatchObject({ status: 'failed', outcome: reason })
      expect(t.store.handledRows(DEF.id)[0].status).toBe('failed')
      expect(t.store.runs.steps('r1')[0]).toMatchObject({ status: 'failed', error: reason })
      expect(t.started).toEqual([])
    }
  )
})
