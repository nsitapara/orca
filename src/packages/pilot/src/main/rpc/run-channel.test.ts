import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Database from '../../../../../main/sqlite/sync-database'
import type { PilotContext } from '../pilot-services'
import { PilotStore } from '../store/store'
import {
  recordRunEvent,
  recordRunOutput,
  resolveChannelRun,
  resolveChannelStep,
  resolveOutputStep,
  type ModeOutputsReader
} from './run-channel'

function setup() {
  const path = join(mkdtempSync(join(tmpdir(), 'pilot-channel-')), 'db.sqlite')
  const store = PilotStore.open(path)
  store.runs.create({
    id: 'run-1',
    automationId: 'review',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt',
    startedAt: 1
  })
  store.runs.createStep({
    runId: 'run-1',
    idx: 0,
    name: 'review',
    agent: 'claude',
    skill: 'review-cycles',
    mode: 'review',
    startedAt: 1
  })
  const ctx = { store } as unknown as PilotContext
  const events = () => {
    const db = new Database(path)
    try {
      return db
        .prepare(
          'SELECT automation_id, run_id, worktree_path, item_key, kind, payload_json FROM events ORDER BY id'
        )
        .all()
    } finally {
      db.close()
    }
  }
  return { ctx, store, events }
}
const declares =
  (outputs: string[] | null): ModeOutputsReader =>
  () => ({ outputs })
const unreadable: ModeOutputsReader = () => {
  throw new Error('Mode "review" of skill "review-cycles" not found')
}
const row = (kind: string, payload: unknown) => ({
  automation_id: 'review',
  run_id: 'run-1',
  worktree_path: '/wt',
  item_key: 'mr:1',
  kind,
  payload_json: JSON.stringify(payload)
})

describe('recordRunOutput', () => {
  it('merges outputs across calls into the step, with an event for each', () => {
    const { ctx, events } = setup()
    recordRunOutput(
      ctx,
      { runId: 'run-1', stepIdx: 0, outputs: { changed: true } },
      declares(null),
      () => 5
    )
    expect(
      recordRunOutput(
        ctx,
        { runId: 'run-1', stepIdx: 0, outputs: { report: 'a.md' } },
        declares(null),
        () => 6
      )
    ).toEqual({
      runId: 'run-1',
      stepIdx: 0,
      outputs: { changed: true, report: 'a.md' }
    })
    expect(events()).toEqual([
      row('step_output', { step: 'review', outputs: { changed: true } }),
      row('step_output', { step: 'review', outputs: { report: 'a.md' } })
    ])
  })

  it("refuses an output its mode doesn't declare, naming the ones it does", () => {
    const { ctx } = setup()
    expect(() =>
      recordRunOutput(
        ctx,
        { runId: 'run-1', stepIdx: 0, outputs: { chnaged: true } },
        declares(['changed'])
      )
    ).toThrow("Step review (mode review) declares changed; chnaged isn't one of them")
  })

  it.each([['summary'], ['outcome'], ['item_status'], ['reply']])(
    'always accepts the reserved output %s, even from a mode that declares none',
    (name) => {
      const { ctx } = setup()
      expect(
        recordRunOutput(
          ctx,
          { runId: 'run-1', stepIdx: 0, outputs: { [name]: 'ok' } },
          declares([])
        ).outputs
      ).toEqual({ [name]: 'ok' })
    }
  )

  it("accepts any output when the step's mode can't be read", () => {
    const { ctx } = setup()
    expect(
      recordRunOutput(ctx, { runId: 'run-1', stepIdx: 0, outputs: { anything: 1 } }, unreadable)
        .outputs
    ).toEqual({ anything: 1 })
  })

  it.each([
    ['an unknown run', { runId: 'run-9', stepIdx: 0, outputs: { a: 1 } }, 'No run run-9'],
    [
      'an unknown step',
      { runId: 'run-1', stepIdx: 3, outputs: { a: 1 } },
      'Run run-1 has no step 3'
    ]
  ])('refuses %s', (_n, params, message) => {
    const { ctx } = setup()
    expect(() => recordRunOutput(ctx, params, declares(null))).toThrow(message)
  })
})

describe('recordRunEvent', () => {
  it("records the event against the run's automation, worktree and item", () => {
    const { ctx, events } = setup()
    expect(
      recordRunEvent(ctx, { runId: 'run-1', kind: 'pushed', payload: { sha: 'abc1234' } }, () => 7)
        .id
    ).toBeGreaterThan(0)
    expect(events()).toEqual([row('pushed', { sha: 'abc1234' })])
  })
})

// An env run works in its env's folder (worktreePath) but belongs to its home: its events go where addRunEvent puts them.
describe("an env run's channel events", () => {
  it.each([
    [
      'a step output',
      (ctx: PilotContext) =>
        recordRunOutput(ctx, { runId: 'run-1', stepIdx: 0, outputs: { a: 1 } }, declares(null))
    ],
    ['a run event', (ctx: PilotContext) => recordRunEvent(ctx, { runId: 'run-1', kind: 'pushed' })]
  ])("%s is recorded against the run's home, not the throwaway it works in", (_name, record) => {
    const { ctx, store, events } = setup()
    store.runs.envs.begin('run-1', '/wt', {})
    store.runs.envs.ready('run-1', {
      mode: 'throwaway',
      reason: '',
      path: '/agents/agents-run-1',
      home: '/wt',
      worktreeId: 'id',
      sha: null,
      envFile: null,
      vars: {},
      stack: null
    })
    record(ctx)
    expect(events().map((e) => (e as { worktree_path: string }).worktree_path)).toEqual(['/wt'])
  })
})

// Ruling 8d: the terminal a command runs in names its step; env is only the fallback.
describe('resolveChannelStep / resolveChannelRun', () => {
  function withSentStep() {
    const s = setup()
    s.store.runs.updateStep('run-1', 0, { status: 'done', terminalHandle: 'term-A', finishedAt: 2 })
    s.store.runs.createStep({
      runId: 'run-1',
      idx: 1,
      name: 'fix',
      agent: 'claude',
      skill: null,
      startedAt: 3
    })
    s.store.runs.updateStep('run-1', 1, { status: 'running', terminalHandle: 'term-A' })
    return s
  }

  it("maps a step sent into an earlier step's terminal to itself, over the env's step", () => {
    const { ctx } = withSentStep()
    expect(resolveChannelStep(ctx, { terminal: 'term-A', runId: 'run-1', stepIdx: 0 })).toEqual({
      runId: 'run-1',
      stepIdx: 1
    })
    expect(resolveChannelRun(ctx, { terminal: 'term-A', runId: 'run-9' })).toBe('run-1')
  })

  it.each([
    [
      'no step is bound to the terminal',
      { terminal: 'term-Z', runId: 'run-1', stepIdx: 1 },
      { runId: 'run-1', stepIdx: 1 }
    ],
    ['no terminal is given', { runId: 'run-1', stepIdx: 1 }, { runId: 'run-1', stepIdx: 1 }]
  ])('falls back to the env when %s', (_n, target, expected) => {
    const { ctx } = withSentStep()
    expect(resolveChannelStep(ctx, target)).toEqual(expected)
  })

  it('ignores a terminal whose step has finished, and then refuses the ended env step', () => {
    const { ctx, store } = withSentStep()
    store.runs.updateStep('run-1', 1, { status: 'done' })
    expect(() =>
      resolveChannelStep(ctx, { terminal: 'term-A', runId: 'run-1', stepIdx: 0 })
    ).toThrow('Step 0 of run run-1 has ended')
  })

  it('prefers the env step when it is also active on that terminal', () => {
    const { ctx, store } = withSentStep()
    store.runs.updateStep('run-1', 0, { status: 'running' })
    expect(resolveChannelStep(ctx, { terminal: 'term-A', runId: 'run-1', stepIdx: 0 })).toEqual({
      runId: 'run-1',
      stepIdx: 0
    })
    expect(resolveChannelStep(ctx, { terminal: 'term-A', runId: 'run-1', stepIdx: 1 })).toEqual({
      runId: 'run-1',
      stepIdx: 1
    })
    expect(resolveChannelStep(ctx, { terminal: 'term-A' })).toEqual({ runId: 'run-1', stepIdx: 1 })
  })

  it('accepts an env step that is active, with no terminal', () => {
    const { ctx } = withSentStep()
    expect(resolveChannelStep(ctx, { runId: 'run-1', stepIdx: 1 })).toEqual({
      runId: 'run-1',
      stepIdx: 1
    })
    expect(resolveChannelRun(ctx, { runId: 'run-1' })).toBe('run-1')
  })

  it('refuses an env step that has ended, or one in a run that has ended', () => {
    const { ctx, store } = withSentStep()
    expect(() => resolveChannelStep(ctx, { runId: 'run-1', stepIdx: 0 })).toThrow(
      'Step 0 of run run-1 has ended'
    )
    store.runs.update('run-1', { status: 'failed' })
    expect(() => resolveChannelStep(ctx, { runId: 'run-1', stepIdx: 1 })).toThrow(
      'Step 1 of run run-1 has ended'
    )
    expect(() => resolveChannelRun(ctx, { runId: 'run-1' })).toThrow('Run run-1 has ended (failed)')
  })

  describe('a detached session (wait: start)', () => {
    function withDetached(runStatus: 'running' | 'cancelled', detached: boolean) {
      const s = setup()
      s.store.runs.updateStep('run-1', 0, {
        status: 'done',
        terminalHandle: 'term-A',
        finishedAt: 2,
        detached
      })
      s.store.runs.update('run-1', { status: runStatus })
      return s
    }

    it.each([
      ['an open run', 'running'],
      ['a stopped run', 'cancelled']
    ] as const)('keeps its terminal and env binding in %s', (_n, runStatus) => {
      const { ctx } = withDetached(runStatus, true)
      const expected = { runId: 'run-1', stepIdx: 0 }
      expect(resolveChannelStep(ctx, { terminal: 'term-A' })).toEqual(expected)
      expect(resolveChannelStep(ctx, { runId: 'run-1', stepIdx: 0 })).toEqual(expected)
    })

    it('binds nothing for a done step that is not detached', () => {
      const { ctx } = withDetached('running', false)
      expect(() => resolveChannelStep(ctx, { terminal: 'term-A' })).toThrow(
        "Not inside a Pilot run's step"
      )
    })

    it('binds nothing from a handle no step holds once its tab closed; the step stays done', () => {
      const { ctx, store } = withDetached('running', true)
      expect(() => resolveChannelStep(ctx, { terminal: 'term-gone' })).toThrow(
        "Not inside a Pilot run's step"
      )
      expect(store.runs.steps('run-1')[0]?.status).toBe('done')
    })
  })

  it.each([[{}], [{ terminal: 'term-Z' }], [{ runId: 'run-1' }]])(
    "refuses %j with neither a bound terminal nor the env's step",
    (target) => {
      const { ctx } = withSentStep()
      expect(() => resolveChannelStep(ctx, target)).toThrow("Not inside a Pilot run's step")
    }
  )
})

describe('resolveOutputStep: who may write a step’s outputs through the run channel', () => {
  // run-1: step 0 an agent step running on term-A, step 1 a shell step running (no terminal) that declares `ticket`.
  function withShellStep() {
    const s = setup()
    s.store.runs.updateStep('run-1', 0, { status: 'running', terminalHandle: 'term-A' })
    s.store.runs.createStep({
      runId: 'run-1',
      idx: 1,
      name: 'ticket',
      agent: 'shell',
      skill: null,
      kind: 'shell',
      startedAt: 2
    })
    s.store.runs.updateStep('run-1', 1, { status: 'running' })
    // What its $PILOT_OUTPUT_FILE gave, as shell-step.ts merges it when the process ends.
    s.store.advance.mergeStepOutputs('run-1', 1, { ticket: 'WEB-1' })
    return s
  }

  it('refuses a write the env names for a shell step, and leaves its file outputs as they are', () => {
    const { ctx, store } = withShellStep()
    for (const target of [
      { runId: 'run-1', stepIdx: 1 },
      { terminal: 'term-Z', runId: 'run-1', stepIdx: 1 }
    ]) {
      expect(() => resolveOutputStep(ctx, target)).toThrow(
        "pilot run output works only from an agent step's own terminal"
      )
    }
    expect(() =>
      recordRunOutput(
        ctx,
        { runId: 'run-1', stepIdx: 1, outputs: { ticket: 'WEB-9999' } },
        declares(null)
      )
    ).toThrow('Step ticket is a shell step: its outputs come only from its $PILOT_OUTPUT_FILE')
    expect(store.runs.steps('run-1')[1].outputs).toEqual({ ticket: 'WEB-1' })
  })

  it('refuses a write the env names for an agent step from no bound terminal', () => {
    const { ctx } = withShellStep()
    expect(() => resolveOutputStep(ctx, { runId: 'run-1', stepIdx: 0 })).toThrow(
      "pilot run output works only from an agent step's own terminal"
    )
  })

  it('accepts a write from the agent step’s own terminal, the env choosing among the steps bound there', () => {
    const { ctx } = withShellStep()
    expect(resolveOutputStep(ctx, { terminal: 'term-A' })).toEqual({ runId: 'run-1', stepIdx: 0 })
    expect(resolveOutputStep(ctx, { terminal: 'term-A', runId: 'run-1', stepIdx: 0 })).toEqual({
      runId: 'run-1',
      stepIdx: 0
    })
  })
})
