import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Database from '../../../../../main/sqlite/sync-database'
import type { ItemDecision } from '../../shared/api-types'
import { parseAutomationYaml } from '../../shared/definition/parse'
import type { AutomationDefinition } from '../../shared/definition/types'
import { UnrecordedLaunchError } from '../scheduler/tick-runner'
import { PilotStore } from '../store/store'
import {
  createRunEngine,
  ANSWER_STEP_TIMEOUT_MS,
  runStepTimeoutMs,
  stepTimeoutMs,
  type RunEngine,
  type RunEngineDeps,
  type StepStartRequest
} from './advance'
import { STALE_START_OUTCOME } from './stale-starts'
import { NothingToDoError } from './nothing-to-do'
import type { WorkspaceDeps } from './workspace'

const YAML = `name: Review and fix
repo: web-platform
schedule: manual
items: { kind: merge_request }
limits: { timeout: 60m }
steps:
  - { name: review, agent: claude, skill: review-cycles, prompt: Review it, timeout: 20m }
  - { name: fix, agent: claude, prompt: Fix it, when: "{steps.review.changed} == true" }
  - { name: cleanup, agent: claude, prompt: Tidy up, always: true }
`
function definitionOf(yaml: string): AutomationDefinition {
  const parsed = parseAutomationYaml(yaml, '/a/review.yaml')
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  return parsed.definition
}
const DEF = definitionOf(YAML)
const DECISION: ItemDecision = {
  key: 'mr:1',
  label: '!1 web-1',
  verdict: 'started',
  reason: '',
  checks: [],
  onceKey: '1:9',
  fields: { 'mr.iid': 1, 'worktree.path': '/wt', 'worktree.id': 'wt-1' }
}
// item_worktree workspaces read the item's own fields; nothing here lists, creates or claims a worktree.
const WORKSPACE: WorkspaceDeps = {
  listWorktrees: async () => [],
  createWorktree: async () => {
    throw new Error('createWorktree is not expected')
  },
  claimWorktree: () => {
    throw new Error('claimWorktree is not expected')
  }
}
const INBOX_ITEM = `INSERT INTO inbox_items (id, automation_id, run_id, person, type, title, digest, created_at, updated_at)
  VALUES ('q1', 'review', 'run-1', 'nish', 'question', 'Push?', 'd1', 1, 1)`

type Ending = 'done' | 'failed' | 'timed_out'

function setup(def: AutomationDefinition | null = DEF, over: Partial<RunEngineDeps> = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'pilot-advance-')), 'db.sqlite')
  const store = PilotStore.open(path)
  const started: StepStartRequest[] = []
  const statusWhenStarted: (string | null)[] = []
  // A function runs when its launch is due (what happened meanwhile) and returns the error to throw.
  const failures: (Error | (() => Error))[] = []
  const deps: RunEngineDeps = {
    store,
    now: () => 1000,
    definitionFor: (id) => (def !== null && id === def.id ? def : null),
    // Stands in for the launcher: it creates its row or, as Task 8d's launcher does, takes over the
    // `pending` one the engine wrote for step 0.
    startStep: async (req) => {
      const failure = failures.shift()
      if (failure) {
        throw typeof failure === 'function' ? failure() : failure
      }
      started.push(req)
      const s = req.definition.steps[req.idx]
      const existing = store.runs.steps(req.run.id).find((r) => r.idx === req.idx)
      statusWhenStarted.push(existing?.status ?? null)
      if (!existing) {
        store.runs.createStep({
          runId: req.run.id,
          idx: req.idx,
          name: s.name,
          agent: s.agent,
          skill: s.skill,
          startedAt: 1000
        })
      }
      store.runs.updateStep(req.run.id, req.idx, {
        status: 'running',
        terminalHandle: `t${req.idx}`,
        paneKey: `p${req.idx}`
      })
    },
    workspace: WORKSPACE,
    log: () => {},
    ...over
  }
  const engine = createRunEngine(deps)
  store.runs.create({
    id: 'run-1',
    automationId: 'review',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1 web-1',
    worktreePath: '/wt',
    startedAt: 500
  })
  store.markHandled('review', '1:9', 'run-1', 500)
  const end = (
    idx: number,
    status: Ending,
    extra: { error?: string; costUsd?: number; tokens?: number } = {}
  ) => store.runs.updateStep('run-1', idx, { status, finishedAt: 1000, ...extra })
  const db = <T>(work: (d: Database) => T): T => {
    const d = new Database(path)
    try {
      return work(d)
    } finally {
      d.close()
    }
  }
  return { store, deps, engine, started, statusWhenStarted, failures, end, db }
}
const startRun = (engine: RunEngine) =>
  engine.startRun({ runId: 'run-1', definition: DEF, decision: DECISION })
const handledOf = (db: ReturnType<typeof setup>['db']) =>
  db((d) => d.prepare("SELECT status, failed_at FROM handled WHERE run_id = 'run-1'").get())

describe('createRunEngine', () => {
  it('starts the first step with the item, workspace and run fields', async () => {
    const { engine, started } = setup()
    await startRun(engine)
    expect(started.map((s) => s.idx)).toEqual([0])
    expect(started[0].fields).toMatchObject({
      'mr.iid': 1,
      'worktree.path': '/wt',
      'run.id': 'run-1',
      'run.automation': 'review'
    })
    expect(started[0].fields['run.failed']).toBe(false)
    expect(started[0].fields['run.answer']).toBeNull()
  })

  it('writes step 0 as pending, records the workspace on the run, then hands the step to the starter', async () => {
    const { store, engine, statusWhenStarted } = setup()
    await startRun(engine)
    expect(statusWhenStarted).toEqual(['pending'])
    expect(store.runs.get('run-1')).toMatchObject({ worktreePath: '/wt', worktreeId: 'wt-1' })
    expect(store.runs.steps('run-1')[0]).toMatchObject({ status: 'running', name: 'review' })
  })

  it('fails step 0 with the workspace error and rethrows it, so the tick frees the item', async () => {
    const { store, engine, started } = setup()
    const noWorktree = { ...DECISION, fields: { 'mr.iid': 1 } }
    await expect(
      engine.startRun({ runId: 'run-1', definition: DEF, decision: noWorktree })
    ).rejects.toThrow('No worktree for !1 web-1')
    expect(started).toEqual([])
    expect(store.runs.steps('run-1')).toHaveLength(1)
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'failed',
      error: 'No worktree for !1 web-1'
    })
  })

  // A new worktree's claim only sees running runs (Task 8b), so the run must be running first.
  it('refuses to start a run that is no longer running, before writing a step or resolving a workspace', async () => {
    const { store, engine, started } = setup()
    store.runs.update('run-1', { status: 'failed' })
    await expect(startRun(engine)).rejects.toThrow('Run run-1 is failed, not running')
    expect(started).toEqual([])
    expect(store.runs.steps('run-1')).toEqual([])
    expect(store.runs.get('run-1')?.worktreeId).toBeNull()
  })

  it('leaves a run without any step to startRun: advancing it starts nothing and ends nothing', async () => {
    const { store, engine, started } = setup()
    await engine.advance('run-1')
    expect(started).toEqual([])
    expect(store.runs.get('run-1')).toMatchObject({ status: 'running', worktreeId: null })
  })

  it('does not advance a run whose step 0 is still pending', async () => {
    const { store, engine, started } = setup()
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 'review',
      agent: 'claude',
      skill: 'review-cycles',
      status: 'pending',
      startedAt: 600
    })
    await engine.advance('run-1')
    expect(started).toEqual([])
    expect(store.runs.get('run-1')?.status).toBe('running')
  })

  it("renders run.answer from the engine's runAnswer source", async () => {
    const { engine, started } = setup(DEF, { runAnswer: () => 'use the second fix' })
    await startRun(engine)
    expect(started[0].fields['run.answer']).toBe('use the second fix')
  })

  it("renders run.choice from the engine's runChoice source, '' without one", async () => {
    const chose = setup(DEF, { runChoice: () => 'Full stack + UI' })
    await startRun(chose.engine)
    expect(chose.started[0].fields['run.choice']).toBe('Full stack + UI')
    const plain = setup()
    await startRun(plain.engine)
    expect(plain.started[0].fields['run.choice']).toBe('')
  })

  it('starts nothing while a step still runs', async () => {
    const { engine, started } = setup()
    await startRun(engine)
    await engine.advance('run-1')
    expect(started).toHaveLength(1)
  })

  it("starts the next step when one ends, with the ended step's outputs as fields", async () => {
    const { store, engine, started, end } = setup()
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: true })
    end(0, 'done')
    await engine.advance('run-1')
    expect(started.map((s) => s.idx)).toEqual([0, 1])
    expect(started[1].fields['steps.review.changed']).toBe(true)
    expect(store.runs.get('run-1')?.status).toBe('running')
  })

  it('skips a step whose when is false, still runs the always step, and ends the run done', async () => {
    const { store, engine, started, end, db } = setup()
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: false })
    end(0, 'done')
    await engine.advance('run-1')
    expect(store.runs.steps('run-1')[1]).toMatchObject({
      status: 'skipped',
      error: 'when: {steps.review.changed} == true is false'
    })
    expect(started.map((s) => s.idx)).toEqual([0, 2])
    end(2, 'done')
    await engine.advance('run-1')
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'done',
      outcome: 'Done',
      finishedAt: 1000
    })
    expect(handledOf(db)).toEqual({ status: 'done', failed_at: null })
  })

  it('after a step stopped the run skips the rest but the always step, ends it done with Nothing to do, and settles its key done', async () => {
    const { store, engine, started, end, db } = setup()
    await startRun(engine)
    store.runs.updateStep('run-1', 0, {
      status: 'stopped',
      error: 'pipeline 2934 is green',
      finishedAt: 1000
    })
    await engine.advance('run-1')
    expect(store.runs.steps('run-1')[1]).toMatchObject({
      status: 'skipped',
      error: 'Step review had nothing to do'
    })
    expect(started.map((s) => s.idx)).toEqual([0, 2])
    end(2, 'done')
    await engine.advance('run-1')
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'done',
      outcome: 'Nothing to do: pipeline 2934 is green'
    })
    expect(handledOf(db)).toEqual({ status: 'done', failed_at: null })
  })

  it('after a failed step skips the rest but the always step, and fails the run naming the step', async () => {
    const { store, engine, started, end, db } = setup()
    await startRun(engine)
    end(0, 'failed', { error: 'boom' })
    await engine.advance('run-1')
    expect(store.runs.steps('run-1')[1]).toMatchObject({
      status: 'skipped',
      error: 'Step review failed'
    })
    expect(started.map((s) => s.idx)).toEqual([0, 2])
    end(2, 'done')
    await engine.advance('run-1')
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'failed',
      outcome: 'Step review failed: boom'
    })
    expect(handledOf(db)).toEqual({ status: 'failed', failed_at: 1000 })
  })

  it.each([
    ['timed_out when a step timed out', 'timed_out', false, 'timed_out', 'Step review timed out'],
    ['needs_you when an inbox item is still open', 'done', true, 'needs_you', 'Inbox: 1 open item']
  ] as const)('ends the run %s', async (_n, firstEnd, openItem, status, outcome) => {
    const { store, engine, end, db } = setup()
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: false })
    end(0, firstEnd)
    if (openItem) {
      db((d) => d.exec(INBOX_ITEM))
    }
    await engine.advance('run-1')
    end(2, 'done')
    await engine.advance('run-1')
    expect(store.runs.get('run-1')).toMatchObject({ status, outcome })
  })

  it("sums every step's cost and tokens into the run", async () => {
    const { store, engine, end } = setup()
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: false })
    end(0, 'done', { costUsd: 1.5, tokens: 100 })
    await engine.advance('run-1')
    end(2, 'done', { costUsd: 0.25, tokens: 20 })
    await engine.advance('run-1')
    expect(store.runs.get('run-1')).toMatchObject({ costUsd: 1.75, tokens: 120 })
  })

  it("records a later step that couldn't start as failed and still runs the always step", async () => {
    const { store, engine, started, end, failures } = setup()
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: true })
    end(0, 'done')
    failures.push(new Error('worktree is gone'))
    await engine.advance('run-1')
    expect(store.runs.steps('run-1')[1]).toMatchObject({
      status: 'failed',
      error: 'worktree is gone'
    })
    expect(started.map((s) => s.idx)).toEqual([0, 2])
  })

  it('throws from startRun when the first step cannot start, so the tick frees the item', async () => {
    const { store, engine, failures } = setup()
    failures.push(new Error('terminal refused'))
    await expect(startRun(engine)).rejects.toThrow('terminal refused')
    expect(store.runs.steps('run-1').map((s) => [s.status, s.error])).toEqual([
      ['failed', 'terminal refused']
    ])
  })

  // A context-preparation card answered or prepared before the claim at launch: nothing to do, not a failure.
  it('stops a first step whose starter found nothing to do, and ends the run done with Nothing to do', async () => {
    const { store, engine, started, end, failures } = setup()
    failures.push(new NothingToDoError('the card was already answered'))
    await startRun(engine)
    expect(store.runs.steps('run-1').map((s) => [s.name, s.status, s.error])).toEqual([
      ['review', 'stopped', 'the card was already answered'],
      ['fix', 'skipped', 'Step review had nothing to do'],
      ['cleanup', 'running', null]
    ])
    expect(started.map((s) => s.idx)).toEqual([2])
    end(2, 'done')
    await engine.advance('run-1')
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'done',
      outcome: 'Nothing to do: the card was already answered'
    })
  })

  it('does not replay an advance that came in while a failed startRun was going: the tick fails that run', async () => {
    const engines: RunEngine[] = []
    let calls = 0
    const { store, engine } = setup(DEF, {
      startStep: async () => {
        calls += 1
        void engines[0].advance('run-1')
        throw new Error('terminal refused')
      }
    })
    engines.push(engine)
    await expect(startRun(engine)).rejects.toThrow('terminal refused')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toBe(1)
    expect(store.runs.steps('run-1').map((s) => s.status)).toEqual(['failed'])
  })

  it.each([0, 1])(
    'stops the walk when step %i leaves its agent untracked, and keeps the key from a retry',
    async (at) => {
      const { store, engine, started, end, failures, db } = setup()
      const orphan = new UnrecordedLaunchError('t9', "terminal t9 started but couldn't be recorded")
      if (at === 0) {
        failures.push(orphan)
        await expect(startRun(engine)).rejects.toBe(orphan)
      } else {
        await startRun(engine)
        store.advance.mergeStepOutputs('run-1', 0, { changed: true })
        end(0, 'done')
        failures.push(orphan)
        await engine.advance('run-1')
      }
      expect(started.map((s) => s.idx)).toEqual([0].slice(0, at))
      const notRun = ['skipped', 'Not run: an untracked agent is still in terminal t9']
      expect(store.runs.steps('run-1').map((s) => [s.status, s.error])).toEqual([
        ...(at === 1 ? [['done', null]] : []),
        ['failed', orphan.message],
        ...[notRun, notRun].slice(at)
      ])
      expect(store.runs.get('run-1')).toMatchObject({ status: 'failed', outcome: orphan.message })
      expect(handledOf(db)).toEqual({ status: 'done', failed_at: null })
      const events = store.events.forRun('run-1').filter((e) => e.kind === 'orphan_agent')
      expect(events.map((e) => e.payload)).toEqual([
        { step: DEF.steps[at].name, terminal: 't9', error: orphan.message }
      ])
    }
  )

  it('stops when the run was closed while a step failed to start, keeping how it was closed', async () => {
    const ended: string[] = []
    const { store, engine, started, end, failures } = setup(DEF, {
      onRunEnd: (run) => ended.push(run.id)
    })
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: true })
    end(0, 'done')
    // The stale-start sweep closes the run during step 1's slow launch, which then throws.
    failures.push(() => {
      store.runs.update('run-1', { status: 'failed', outcome: 'swept', finishedAt: 900 })
      return new Error('launch gave up')
    })
    await engine.advance('run-1')
    expect(started.map((s) => s.idx)).toEqual([0])
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'failed',
      outcome: 'swept',
      finishedAt: 900
    })
    expect(ended).toEqual([])
  })

  it("renders a later step's item fields before its tick has recorded them, and from the tick after a restart", async () => {
    const { store, deps, engine, started } = setup()
    const tickId = store.startTick('review', 400)
    store.runs.create({
      id: 'run-t',
      automationId: 'review',
      tickId,
      itemKey: 'mr:1',
      itemLabel: '!1 web-1',
      worktreePath: '/wt',
      startedAt: 500
    })
    await engine.startRun({ runId: 'run-t', definition: DEF, decision: DECISION })
    store.advance.mergeStepOutputs('run-t', 0, { changed: true })
    store.runs.updateStep('run-t', 0, { status: 'done', finishedAt: 1000 })
    expect(store.advance.tickItemFields(tickId, 'mr:1')).toBeNull()
    await engine.advance('run-t')
    expect(started[1].fields).toMatchObject({ 'mr.iid': 1, 'run.tick': tickId })
    // A restarted engine knows nothing of the run; by then the tick has recorded the item's fields.
    store.recordDecisions(tickId, [DECISION], new Map([['mr:1', 'run-t']]))
    store.runs.updateStep('run-t', 1, { status: 'done', finishedAt: 1000 })
    await createRunEngine(deps).advance('run-t')
    expect(started.map((s) => [s.idx, s.fields['mr.iid']])).toEqual([
      [0, 1],
      [1, 1],
      [2, 1]
    ])
  })

  it("holds a later orphan's key again after the stale-start sweep freed it, so no tick retries the item", async () => {
    const { store, engine, end, failures, db } = setup()
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: true })
    end(0, 'done')
    // The sweep closed the run during step 1's slow launch and freed its key; then the agent appeared.
    failures.push(() => {
      store.unmarkHandledForRun('review', 'run-1')
      store.runs.update('run-1', {
        status: 'failed',
        outcome: STALE_START_OUTCOME,
        finishedAt: 900
      })
      return new UnrecordedLaunchError('t9', 'terminal t9 started but could not be recorded')
    })
    await engine.advance('run-1')
    const key = db((d) =>
      d.prepare("SELECT once_key, status, failed_at FROM handled WHERE run_id = 'run-1'").get()
    )
    expect(key).toEqual({ once_key: '1:9', status: 'done', failed_at: null })
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'failed',
      outcome: STALE_START_OUTCOME
    })
  })

  const unreadable: Partial<RunEngineDeps> = {
    runAnswer: () => {
      throw new Error('answers unreadable')
    }
  }
  it.each([
    [
      'returns (its automation is unloaded)',
      null,
      {},
      null,
      'The automation review is no longer loaded'
    ],
    [
      'throws (run.answer is unreadable)',
      DEF,
      unreadable,
      'answers unreadable',
      'answers unreadable'
    ]
  ] as [string, AutomationDefinition | null, Partial<RunEngineDeps>, string | null, string][])(
    'fails a step 0 the opening walk never handed to the starter when the walk %s',
    async (_n, def, over, thrown, error) => {
      const { store, engine, started } = setup(def, over)
      const settled = await startRun(engine).then(
        () => null,
        (e: Error) => e.message
      )
      expect(settled).toBe(thrown)
      expect(started).toEqual([])
      expect(store.runs.steps('run-1').map((s) => [s.status, s.error])).toEqual([['failed', error]])
    }
  )

  it.each([
    ['its automation is gone', null, 'review', 'The automation review is no longer loaded'],
    [
      'its steps changed',
      DEF,
      'triage',
      "The automation's steps changed while this run was going; it stopped after step triage"
    ]
  ] as const)('fails the run when %s', async (_n, def, rowName, outcome) => {
    const { store, engine } = setup(def)
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: rowName,
      agent: 'claude',
      skill: null,
      startedAt: 600
    })
    store.runs.updateStep('run-1', 0, { status: 'done', finishedAt: 700 })
    await engine.advance('run-1')
    expect(store.runs.get('run-1')).toMatchObject({ status: 'failed', outcome })
  })

  it.each([
    ['runs after a failure', 'failed', 'Step review failed: boom', [0, 2]],
    ['is skipped when nothing failed', 'done', 'Done', [0]]
  ] as const)(
    'an always step with when {run.failed} %s',
    async (_n, firstEnd, outcome, startedIdx) => {
      const def = definitionOf(
        YAML.replace('Tidy up, always: true', 'Tidy up, always: true, when: "{run.failed} == true"')
      )
      const { store, engine, started, end } = setup(def)
      await engine.startRun({ runId: 'run-1', definition: def, decision: DECISION })
      store.advance.mergeStepOutputs('run-1', 0, { changed: false })
      end(0, firstEnd, firstEnd === 'failed' ? { error: 'boom' } : {})
      await engine.advance('run-1')
      if (startedIdx.length > 1) {
        end(2, 'done')
        await engine.advance('run-1')
      }
      expect(started.map((s) => s.idx)).toEqual(startedIdx)
      expect(store.runs.get('run-1')?.outcome).toBe(outcome)
    }
  )

  it("records an always step's failure as an event and leaves the run done", async () => {
    const { store, engine, end } = setup()
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: false })
    end(0, 'done')
    await engine.advance('run-1')
    end(2, 'failed', { error: 'rm failed' })
    await engine.advance('run-1')
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'done',
      outcome: 'Done; cleanup step cleanup failed'
    })
    const events = store.events.forRun('run-1').filter((e) => e.kind === 'always_step_failed')
    expect(events.map((e) => e.payload)).toEqual([
      { step: 'cleanup', status: 'failed', error: 'rm failed' }
    ])
  })

  it('calls onRunEnd once with the finished run and its end', async () => {
    const ended: [string, string, string][] = []
    const { store, engine, end } = setup(DEF, {
      onRunEnd: (run, e) => ended.push([run.id, e.status, e.outcome])
    })
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: false })
    end(0, 'done')
    await engine.advance('run-1')
    end(2, 'done')
    await engine.advance('run-1')
    await engine.advance('run-1')
    expect(ended).toEqual([['run-1', 'done', 'Done']])
  })

  it('hands the run’s end to its handover inside the closing transaction, then its triggers', async () => {
    const seen: string[] = []
    const { store, engine, end } = setup(DEF, {
      handover: {
        write: (run, e) => {
          seen.push(`write ${run.id} ${e.status} while ${store.runs.get(run.id)?.status}`)
          return { note: null, triggers: [] }
        },
        after: () => {
          seen.push(`after while ${store.runs.get('run-1')?.status}`)
        }
      }
    })
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: false })
    end(0, 'done')
    await engine.advance('run-1')
    end(2, 'done')
    await engine.advance('run-1')
    expect(seen).toEqual(['write run-1 done while running', 'after while done'])
  })

  it('ends an answer run after its last recorded step without reading the definition, then calls onRunEnd', async () => {
    const ended: string[] = []
    const { store, engine, started } = setup(null, { onRunEnd: (run) => ended.push(run.id) })
    store.runs.create({
      id: 'run-a',
      automationId: 'review',
      tickId: null,
      itemKey: 'mr:1',
      itemLabel: '!1',
      worktreePath: '/wt',
      startedAt: 600,
      trigger: 'answer',
      parentRunId: 'run-1'
    })
    store.runs.createStep({
      runId: 'run-a',
      idx: 0,
      name: 'answer',
      agent: 'claude',
      skill: null,
      startedAt: 600
    })
    store.runs.updateStep('run-a', 0, { status: 'done', finishedAt: 700 })
    await engine.advance('run-a')
    expect(store.runs.get('run-a')).toMatchObject({ status: 'done', outcome: 'Done' })
    expect(started).toEqual([])
    expect(ended).toEqual(['run-a'])
  })

  it('advanceIdle moves on every run whose steps all ended while Pilot was away', async () => {
    const { store, engine, started } = setup()
    store.runs.create({
      id: 'run-2',
      automationId: 'review',
      tickId: null,
      itemKey: 'mr:2',
      itemLabel: '!2',
      worktreePath: '/wt2',
      startedAt: 600
    })
    store.runs.createStep({
      runId: 'run-2',
      idx: 0,
      name: 'review',
      agent: 'claude',
      skill: 'review-cycles',
      startedAt: 600
    })
    store.advance.mergeStepOutputs('run-2', 0, { changed: true })
    store.runs.updateStep('run-2', 0, { status: 'done', finishedAt: 700 })
    await engine.advanceIdle()
    expect(started.map((s) => [s.run.id, s.idx])).toEqual([['run-2', 1]])
  })

  it('starts the next step once when two advances race', async () => {
    const { store, engine, started, end } = setup()
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: true })
    end(0, 'done')
    await Promise.all([engine.advance('run-1'), engine.advance('run-1')])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(started.map((s) => s.idx)).toEqual([0, 1])
  })
})

describe('stepTimeoutMs', () => {
  it.each([
    ["the step's own timeout", 0, 20 * 60_000],
    ['limits.timeout for a step without one', 1, 60 * 60_000]
  ])('uses %s', (_n, idx, ms) => expect(stepTimeoutMs(DEF, idx)).toBe(ms))

  it('is null when neither is set', () => {
    const def = definitionOf(
      YAML.replace('limits: { timeout: 60m }\n', '').replace(', timeout: 20m', '')
    )
    expect(stepTimeoutMs(def, 0)).toBeNull()
  })
})

// Task 9c ruling: an answer run's one step isn't the definition's step at its index.
describe('runStepTimeoutMs', () => {
  const bare = definitionOf(
    YAML.replace('limits: { timeout: 60m }\n', '').replace(', timeout: 20m', '')
  )
  it.each([
    ['a scheduled run: the step at its index', DEF, 'schedule', 20 * 60_000],
    ["an answer run: limits.timeout, never step 0's own", DEF, 'answer', 60 * 60_000],
    [
      'an answer run with no limits.timeout: the answer-run default',
      bare,
      'answer',
      ANSWER_STEP_TIMEOUT_MS
    ]
  ] as const)('%s', (_n, def, trigger, ms) => {
    expect(runStepTimeoutMs(def, { trigger }, 0)).toBe(ms)
  })
})

describe('continueRun', () => {
  const REASON = 'The terminal closed before the agent finished'
  const stepsOf = (store: PilotStore) => store.runs.steps('run-1').map((s) => [s.name, s.status])

  it('walks a reopened run from the step that broke, hands that step its old session, and ends the run as usual', async () => {
    const { store, engine, started, end, db } = setup()
    await startRun(engine)
    store.advance.mergeStepOutputs('run-1', 0, { changed: true })
    end(0, 'done')
    await engine.advance('run-1')
    end(1, 'failed', { error: REASON })
    await engine.advance('run-1')
    end(2, 'done')
    await engine.advance('run-1')
    expect(store.runs.get('run-1')?.status).toBe('failed')
    store.advance.reopenFrom('run-1', 1, true, 1000)
    const resume = { idx: 1, sessionId: '00000000-0000-4000-8000-0000000000f1', reason: REASON }
    await engine.continueRun('run-1', resume)
    expect(started.map((s) => [s.definition.steps[s.idx].name, s.resume ?? null])).toEqual([
      ['review', null],
      ['fix', null],
      ['cleanup', null],
      ['fix', resume]
    ])
    expect(started[3].fields['steps.review.changed']).toBe(true)
    expect(stepsOf(store)).toEqual([
      ['review', 'done'],
      ['fix', 'running']
    ])
    end(1, 'done')
    await engine.advance('run-1')
    end(2, 'done')
    await engine.advance('run-1')
    expect(store.runs.get('run-1')).toMatchObject({ status: 'done', finishedAt: 1000 })
    expect(handledOf(db)).toMatchObject({ status: 'done' })
  })

  it('walks a run reopened from its first step, which leaves it no row', async () => {
    const { store, engine, started, end } = setup()
    await startRun(engine)
    end(0, 'failed', { error: REASON })
    await engine.advance('run-1')
    end(2, 'done')
    await engine.advance('run-1')
    store.advance.reopenFrom('run-1', 0, false, 1000)
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'running',
      outcome: null,
      finishedAt: null
    })
    await engine.continueRun('run-1', null)
    expect(started.map((s) => s.definition.steps[s.idx].name)).toEqual([
      'review',
      'cleanup',
      'review'
    ])
    expect(stepsOf(store)).toEqual([['review', 'running']])
  })
})
