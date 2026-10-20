import { describe, expect, it, vi } from 'vitest'
import type { RunRow, StepRow, StepStatus, StopRunResult } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import { STOPPED_BY_YOU } from '../../shared/run/stopped-run'
import { PilotStore } from '../store/store'
import { createRunEngine, type RunEngineDeps } from './advance'
import { continueRun, type ContinueRunDeps } from './run-continue'
import { NOT_RUN_STOPPED, SHELL_STEP_RUNNING } from './run-stop'
import type { WorkspaceDeps } from './workspace'

const SESSION = '00000000-0000-4000-8000-0000000000f1'
const DEF = testDefinition({
  id: 'review',
  steps: [
    testStep({ name: 'context', agent: 'shell', run: 'echo' }),
    testStep({ name: 'review' }),
    testStep({ name: 'fix' }),
    testStep({ name: 'flag_failed', agent: 'shell', run: 'echo', always: true })
  ]
})
// A stage reading the ids handed to it, and a job in an env its run's end takes down.
const FED = testDefinition({
  ...DEF,
  items: {
    kind: 'merge_request',
    where: { ids_from: { feed: true } },
    match: [],
    customFields: []
  }
})
const ENV = testDefinition({
  ...DEF,
  workspace: {
    kind: 'env',
    subject: { kind: 'worktree', worktree: '{worktree.path}', at: null },
    writes: true,
    stack: 'never'
  }
})
const WORKSPACE: WorkspaceDeps = {
  listWorktrees: async () => [],
  createWorktree: async () => {
    throw new Error('createWorktree is not expected')
  },
  claimWorktree: () => {
    throw new Error('claimWorktree is not expected')
  }
}
type Step = Pick<StepRow, 'name' | 'agent' | 'kind'> & {
  status: StepStatus
  terminal?: string
  detached?: boolean
}
const CONTEXT: Step = { name: 'context', agent: 'shell', kind: 'shell', status: 'done' }
// The stalled review: context done, review's agent still running in its tab.
const STALLED: Step[] = [
  CONTEXT,
  { name: 'review', agent: 'claude', kind: 'agent', status: 'running', terminal: 't1' }
]

function setup(
  steps: Step[] = STALLED,
  over: Partial<RunEngineDeps> = {},
  trigger: RunRow['trigger'] = 'schedule'
) {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'run-1',
    automationId: 'review',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1 web-1',
    worktreePath: '/wt',
    startedAt: 1,
    trigger
  })
  store.markHandled('review', '1:9', 'run-1', 1)
  for (const [idx, s] of steps.entries()) {
    const { name, agent, kind } = s
    store.runs.createStep({ runId: 'run-1', idx, name, agent, kind, skill: null, startedAt: 2 })
    store.runs.updateStep('run-1', idx, { status: s.status, detached: s.detached ?? false })
    if (s.terminal) {
      const tab = { terminalHandle: s.terminal, paneKey: `pane-${s.terminal}`, sessionId: SESSION }
      store.runs.updateStep('run-1', idx, tab)
    }
  }
  const closeTerminal = vi.fn(async (_handle: string) => {})
  const onRunEnd = vi.fn()
  const relist = vi.fn(async () => false)
  const deps: RunEngineDeps = {
    store,
    now: () => 10,
    definitionFor: (id) => (id === 'review' ? DEF : null),
    startStep: async () => {
      throw new Error('No step starts after a stop')
    },
    workspace: WORKSPACE,
    log: () => {},
    closeTerminal,
    relist,
    onRunEnd,
    ...over
  }
  return { store, deps, engine: createRunEngine(deps), closeTerminal, onRunEnd }
}

const rowsOf = (store: PilotStore) =>
  store.runs.steps('run-1').map((s) => [s.name, s.status, s.error])

describe('stopRun', () => {
  it("closes the running step's tab, fails it, skips every later step (always too) and ends the run cancelled, its key done", async () => {
    const { store, engine, closeTerminal, onRunEnd } = setup()
    await expect(engine.stopRun('run-1')).resolves.toEqual({ stopped: true })
    expect(closeTerminal.mock.calls).toEqual([['t1']])
    expect(rowsOf(store)).toEqual([
      ['context', 'done', null],
      ['review', 'failed', STOPPED_BY_YOU],
      ['fix', 'skipped', NOT_RUN_STOPPED],
      ['flag_failed', 'skipped', NOT_RUN_STOPPED]
    ])
    expect(store.runs.get('run-1')).toMatchObject({
      status: 'cancelled',
      outcome: 'Stopped by you',
      finishedAt: 10
    })
    // Done, not failed: no tick retries the item on its own.
    expect(store.handledRows('review')).toMatchObject([{ status: 'done', failedAt: null }])
    // The run-end hooks (an env's teardown among them) run once, as on any end.
    expect(onRunEnd.mock.calls).toEqual([
      [
        expect.objectContaining({ id: 'run-1', status: 'cancelled' }),
        { status: 'cancelled', outcome: STOPPED_BY_YOU }
      ]
    ])
  })

  // A handle the runtime doesn't know (terminal_handle_stale) may be a live agent from before a restart: only a fresh
  // listing says it is gone. A close that fails, or a liveness nobody can read, changes nothing.
  const STALE = new Error('terminal_handle_stale')
  const LIVE = new Error("Couldn't close terminal t1: its process is live")
  it.each<[string, (Error | null)[], (() => Promise<boolean>) | null, StopRunResult]>([
    ['a stale tab a fresh listing no longer has', [STALE], async () => false, { stopped: true }],
    [
      'a stale tab a fresh listing still has, closed again',
      [STALE, null],
      async () => true,
      { stopped: true }
    ],
    [
      "a stale tab a fresh listing still has, that still won't close",
      [STALE, LIVE],
      async () => true,
      { stopped: false, reason: LIVE.message }
    ],
    [
      "a stale tab whose liveness can't be read",
      [STALE],
      async () => {
        throw new Error('terminal_liveness_unavailable')
      },
      {
        stopped: false,
        reason:
          "Pilot can't tell whether the agent in terminal t1 stopped: terminal_liveness_unavailable"
      }
    ],
    ["a tab that won't close", [LIVE], null, { stopped: false, reason: LIVE.message }]
  ])('stops only once its tab is gone: %s', async (_name, closes, listed, result) => {
    const queue = [...closes]
    const closeTerminal = vi.fn(async () => {
      const failure = queue.shift()
      if (failure) {
        throw failure
      }
    })
    const relist = vi.fn(listed ?? (async () => true))
    const { store, engine, onRunEnd } = setup(STALLED, { closeTerminal, relist })
    const was = { run: store.runs.get('run-1'), steps: store.runs.steps('run-1') }
    await expect(engine.stopRun('run-1')).resolves.toEqual(result)
    expect(relist.mock.calls).toEqual(listed ? [['t1', 'pane-t1']] : [])
    if (result.stopped) {
      expect(store.runs.get('run-1')?.status).toBe('cancelled')
      return
    }
    expect({ run: store.runs.get('run-1'), steps: store.runs.steps('run-1') }).toEqual(was)
    expect(store.handledRows('review')).toMatchObject([{ status: 'started' }])
    expect(onRunEnd).not.toHaveBeenCalled()
  })

  // An answer run launches outside the engine's lock, its step `starting` until its agent is up.
  const LAUNCHING: Step[] = [
    { name: 'answers', agent: 'claude', kind: 'agent', status: 'starting' }
  ]
  it.each<[string, Step[], RunRow['trigger'], (store: PilotStore) => void, string]>([
    [
      'a run that already ended',
      STALLED,
      'schedule',
      (store) => store.runs.update('run-1', { status: 'done', outcome: 'Done', finishedAt: 5 }),
      "Run run-1 isn't running"
    ],
    [
      'a run whose shell step is running',
      [{ ...CONTEXT, status: 'running' }],
      'schedule',
      () => {},
      SHELL_STEP_RUNNING
    ],
    [
      'an answer run launching its agent',
      LAUNCHING,
      'answer',
      () => {},
      'Run run-1 is starting a step; try Stop again in a moment'
    ]
  ])('refuses %s, closing and changing nothing', async (_name, steps, trigger, before, reason) => {
    const { store, engine, closeTerminal, onRunEnd } = setup(steps, {}, trigger)
    before(store)
    const was = { run: store.runs.get('run-1'), steps: store.runs.steps('run-1') }
    await expect(engine.stopRun('run-1')).resolves.toEqual({ stopped: false, reason })
    expect({ run: store.runs.get('run-1'), steps: store.runs.steps('run-1') }).toEqual(was)
    expect(closeTerminal).not.toHaveBeenCalled()
    expect(onRunEnd).not.toHaveBeenCalled()
  })

  it('refuses a second Stop on the run the first just ended, with no second close', async () => {
    const { engine, closeTerminal, onRunEnd } = setup()
    await engine.stopRun('run-1')
    await expect(engine.stopRun('run-1')).resolves.toEqual({
      stopped: false,
      reason: "Run run-1 isn't running"
    })
    expect(closeTerminal).toHaveBeenCalledTimes(1)
    expect(onRunEnd).toHaveBeenCalledTimes(1)
  })

  it('refuses a Stop while the run is starting a step, and closes nothing', async () => {
    let release = (): void => {}
    const startStep = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        })
    )
    const { store, engine, closeTerminal } = setup([CONTEXT], { startStep })
    const walk = engine.advance('run-1')
    await vi.waitFor(() => expect(startStep).toHaveBeenCalled())
    await expect(engine.stopRun('run-1')).resolves.toEqual({
      stopped: false,
      reason: 'Run run-1 is starting a step; try Stop again in a moment'
    })
    release()
    await walk
    expect(closeTerminal).not.toHaveBeenCalled()
    expect(store.runs.get('run-1')?.status).toBe('running')
  })

  it("leaves a detached step and its tab alone: its session isn't the run's to close", async () => {
    const { store, engine, closeTerminal } = setup([
      CONTEXT,
      {
        name: 'review',
        agent: 'claude',
        kind: 'agent',
        status: 'done',
        terminal: 't1',
        detached: true
      },
      { name: 'fix', agent: 'claude', kind: 'agent', status: 'running', terminal: 't2' }
    ])
    await expect(engine.stopRun('run-1')).resolves.toEqual({ stopped: true })
    expect(closeTerminal.mock.calls).toEqual([['t2']])
    expect(store.runs.steps('run-1')[1]).toMatchObject({ status: 'done', detached: true })
    expect(rowsOf(store).slice(2)).toEqual([
      ['fix', 'failed', STOPPED_BY_YOU],
      ['flag_failed', 'skipped', NOT_RUN_STOPPED]
    ])
  })

  it('fails a step the watcher detached while Stop closed its tab, and it no longer reads detached', async () => {
    const closeTerminal = vi.fn(async () => {
      store.runs.updateStep('run-1', 1, { status: 'done', detached: true, finishedAt: 9 })
    })
    const { store, engine } = setup(STALLED, { closeTerminal })
    await expect(engine.stopRun('run-1')).resolves.toEqual({ stopped: true })
    expect(store.runs.steps('run-1')[1]).toMatchObject({
      status: 'failed',
      error: STOPPED_BY_YOU,
      detached: false
    })
  })

  const continueDeps = (store: PilotStore, def: AutomationDefinition) => {
    const continued = vi.fn(async () => {})
    const deps: ContinueRunDeps = {
      store,
      now: () => 20,
      definitionFor: (id) => (id === 'review' ? def : null),
      capacity: { hasFreeSlot: () => true },
      launcherDeps: { transcriptExists: async () => true },
      wired: { engine: { continueRun: continued } }
    }
    return { deps, continued }
  }

  it.each<[string, AutomationDefinition]>([
    ['a run', DEF],
    ['a stage run, which still holds the ids handed to it', FED]
  ])('leaves a stopped run to Continue run, which resumes its session: %s', async (_n, def) => {
    const { store, engine } = setup(STALLED, { definitionFor: () => def })
    await engine.stopRun('run-1')
    const { deps, continued } = continueDeps(store, def)
    await expect(continueRun(deps, 'run-1')).resolves.toEqual({ step: 'review', resumed: true })
    expect(continued).toHaveBeenCalledWith('run-1', {
      idx: 1,
      sessionId: SESSION,
      reason: STOPPED_BY_YOU
    })
  })

  it("leaves an env run to Retry, which frees its key: Continue can't bring its env back", async () => {
    const { store, engine } = setup(STALLED, { definitionFor: () => ENV })
    await engine.stopRun('run-1')
    const { deps } = continueDeps(store, ENV)
    await expect(continueRun(deps, 'run-1')).rejects.toThrow('env workspace')
    expect(store.retryKeysOf(['run-1'])).toEqual(new Map([['run-1', '1:9']]))
    expect(store.resetFailures('review', '1:9')).toBe('mr:1')
    expect(store.handledKeys('review')).toEqual(new Set())
  })
})
