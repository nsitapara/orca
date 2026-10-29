import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { stepFields } from '../../shared/template'
import { PilotStore } from '../store/store'
import {
  pollRunningSteps,
  runtimeStepProbe,
  type ObservedState,
  type StepPollHooks,
  type StepProbe
} from './watcher'

function newStore(): PilotStore {
  return PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-watch-')), 'db.sqlite'))
}

function addRunningStep(store: PilotStore, runId: string, handle: string): void {
  store.runs.create({
    id: runId,
    automationId: 'a',
    tickId: null,
    itemKey: '!1',
    itemLabel: '!1',
    worktreePath: '/wt',
    startedAt: 1
  })
  store.runs.createStep({
    runId,
    idx: 0,
    name: 'step1',
    agent: 'claude',
    skill: null,
    startedAt: 1
  })
  store.runs.updateStep(runId, 0, {
    status: 'running',
    terminalHandle: handle,
    paneKey: `pane-${handle}`
  })
}

function storeWithRunningStep(): PilotStore {
  const store = newStore()
  addRunningStep(store, 'run-1', 'term_1')
  return store
}

const probe = (state: ObservedState, backgroundWork = false): StepProbe => ({
  status: async () => state,
  started: () => false,
  backgroundWork: () => backgroundWork,
  session: () => ({
    id: '00000000-0000-4000-8000-000000000001',
    transcriptPath: '/t/00000000-0000-4000-8000-000000000001.jsonl'
  })
})
const noCost = async () => ({ costUsd: null, tokens: 0 })
const HOUR = 60 * 60_000

function hooks(over: Partial<StepPollHooks> = {}) {
  return {
    timeoutOf: () => null,
    endsAtStart: () => false,
    log: vi.fn(),
    closeTerminal: vi.fn(async () => {}),
    onStepEnded: vi.fn(async () => {}),
    ...over
  }
}

describe('pollRunningSteps', () => {
  it('asks the probe about rows since the step started', async () => {
    const store = storeWithRunningStep()
    const status = vi.fn(async () => 'working' as const)
    await pollRunningSteps(store, { ...probe('working'), status }, noCost, () => 9, hooks())
    expect(status).toHaveBeenCalledWith('term_1', 'pane-term_1', 1)
  })

  it('records the session id while the agent works', async () => {
    const store = storeWithRunningStep()
    await pollRunningSteps(store, probe('working'), noCost, () => 5, hooks())
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'running',
      sessionId: '00000000-0000-4000-8000-000000000001',
      transcriptPath: '/t/00000000-0000-4000-8000-000000000001.jsonl'
    })
  })

  // An answer typed into the asking session, or a step resumed into its tab, while watchers it left still run: the row's
  // state began before the step (stateStartedAt stays pinned for the whole working run), its main agent's after.
  it('ends a step typed into a session done once its own turn is over, closing nothing', async () => {
    const store = storeWithRunningStep()
    const h = hooks({ timeoutOf: () => HOUR })
    const rows = [
      {
        state: 'working',
        workingMode: 'monitoring',
        mainAgent: { state: 'done', stateStartedAt: 5 },
        stateStartedAt: 0,
        receivedAt: 6
      }
    ]
    const real = runtimeStepProbe({
      getAgentStatusRowsForPane: () => rows,
      showTerminal: async () => ({})
    } as unknown as OrcaRuntimeService)
    await pollRunningSteps(store, real, noCost, () => 9, h)
    expect(store.runs.steps('run-1')[0]).toMatchObject({ status: 'done', finishedAt: 9 })
    expect(h.onStepEnded).toHaveBeenCalledWith('run-1')
    expect(h.closeTerminal).not.toHaveBeenCalled()
  })

  it('ends the step with its cost and hands the run to the run engine', async () => {
    const store = storeWithRunningStep()
    const h = hooks()
    await pollRunningSteps(
      store,
      probe('done'),
      async () => ({ costUsd: 1.95, tokens: 120000 }),
      () => 9,
      h
    )
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'done',
      costUsd: 1.95,
      tokens: 120000,
      finishedAt: 9
    })
    expect(h.onStepEnded).toHaveBeenCalledWith('run-1')
    expect(store.runs.get('run-1')?.status).toBe('running')
  })

  describe('a wait: start step', () => {
    const waiting = (started: boolean) => ({
      ...probe('working'),
      started: vi.fn(() => started)
    })

    it('ends done and detached once its session is up, and hands the run on once', async () => {
      const store = storeWithRunningStep()
      const h = hooks({ endsAtStart: () => true })
      const p = waiting(true)
      await pollRunningSteps(store, p, noCost, () => 9, h)
      expect(p.started).toHaveBeenCalledWith('pane-term_1', 1)
      expect(store.runs.steps('run-1')[0]).toMatchObject({
        status: 'done',
        detached: true,
        finishedAt: 9
      })
      expect(h.onStepEnded).toHaveBeenCalledTimes(1)
      expect(h.closeTerminal).not.toHaveBeenCalled()
    })

    it('keeps running while the session has sent no row (or only an earlier step’s)', async () => {
      const store = storeWithRunningStep()
      const h = hooks({ endsAtStart: () => true })
      await pollRunningSteps(store, waiting(false), noCost, () => 9, h)
      expect(store.runs.steps('run-1')[0]).toMatchObject({ status: 'running', detached: false })
      expect(h.onStepEnded).not.toHaveBeenCalled()
    })

    it('is left alone by started() when the step waits for the finish', async () => {
      const store = storeWithRunningStep()
      const h = hooks()
      await pollRunningSteps(store, waiting(true), noCost, () => 9, h)
      expect(store.runs.steps('run-1')[0].status).toBe('running')
    })
  })

  it('fails the step when its terminal is gone before the agent finished, and hands the run on', async () => {
    const store = storeWithRunningStep()
    const h = hooks()
    await pollRunningSteps(store, probe('gone'), noCost, () => 9, h)
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'failed',
      error: 'The terminal closed before the agent finished'
    })
    expect(h.onStepEnded).toHaveBeenCalledWith('run-1')
  })

  it('keeps the step ended when the run engine throws, and still polls the others', async () => {
    const store = newStore()
    addRunningStep(store, 'run-1', 'a')
    addRunningStep(store, 'run-2', 'b')
    const h = hooks({
      onStepEnded: vi.fn(async (runId: string) => {
        if (runId === 'run-1') {
          throw new Error('db busy')
        }
      })
    })
    await pollRunningSteps(store, probe('done'), noCost, () => 9, h)
    expect(store.runs.steps('run-1')[0].status).toBe('done')
    expect(store.runs.steps('run-2')[0].status).toBe('done')
    expect(h.onStepEnded).toHaveBeenCalledTimes(2)
  })

  it('leaves a step alone when its probe throws, and still polls the others', async () => {
    const store = newStore()
    addRunningStep(store, 'run-1', 'bad')
    addRunningStep(store, 'run-2', 'good')
    const flaky: StepProbe = {
      started: () => false,
      backgroundWork: () => false,
      status: async (handle) => {
        if (handle === 'bad') {
          throw new Error('runtime_unavailable')
        }
        return 'done'
      },
      session: () => null
    }
    await pollRunningSteps(store, flaky, noCost, () => 9, hooks())
    expect(store.runs.steps('run-1')[0].status).toBe('running')
    expect(store.runs.steps('run-2')[0].status).toBe('done')
  })

  // The step started at 1 (addRunningStep); "now" is 1 + elapsed. The last column: its agent's turn is over while its
  // background work runs.
  type TimeoutCase = [string, ObservedState, number, string, string | null, boolean?]
  it.each<TimeoutCase>([
    ['working past its timeout', 'working', HOUR, 'timed_out', 'Timed out after 60m'],
    [
      'waiting past its timeout',
      'waiting',
      HOUR,
      'timed_out',
      'Timed out after 60m while it waited in its tab'
    ],
    ['working within its timeout', 'working', HOUR - 1, 'running', null],
    ['done exactly at its timeout', 'done', HOUR, 'done', null],
    // Closing would end the background work its agent's turn left running (agent-rows backgroundWorkRuns).
    [
      'past its timeout, its agent’s turn over and its background work running',
      'working',
      HOUR,
      'timed_out',
      'Timed out after 60m; its tab stays open for the background work its agent left running',
      true
    ]
  ])('a step %s', async (_name, state, elapsed, status, error, background = false) => {
    const store = storeWithRunningStep()
    const h = hooks({ timeoutOf: () => HOUR })
    await pollRunningSteps(store, probe(state, background), noCost, () => 1 + elapsed, h)
    expect(store.runs.steps('run-1')[0]).toMatchObject({ status, ...(error ? { error } : {}) })
    expect(h.closeTerminal).toHaveBeenCalledTimes(status === 'timed_out' && !background ? 1 : 0)
  })

  it('keeps the outputs set with pilot run output when the step times out, and a later step reads them', async () => {
    const store = storeWithRunningStep()
    store.advance.mergeStepOutputs('run-1', 0, { outcome: 'bug', page: 'p1' })
    await pollRunningSteps(
      store,
      probe('working'),
      noCost,
      () => 1 + HOUR,
      hooks({ timeoutOf: () => HOUR })
    )
    const rows = store.runs.steps('run-1')
    expect(rows[0]).toMatchObject({ status: 'timed_out', outputs: { outcome: 'bug', page: 'p1' } })
    expect(stepFields(rows, 1)).toMatchObject({
      'steps.step1.status': 'timed_out',
      'steps.step1.outcome': 'bug',
      'steps.step1.page': 'p1'
    })
  })

  it('never times out a step that has no timeout', async () => {
    const store = storeWithRunningStep()
    const h = hooks()
    await pollRunningSteps(store, probe('waiting'), noCost, () => 10 * HOUR, h)
    expect(store.runs.steps('run-1')[0].status).toBe('running')
    expect(h.closeTerminal).not.toHaveBeenCalled()
  })

  it('keeps a timed-out step running when its terminal could not be closed, for the next poll', async () => {
    const store = storeWithRunningStep()
    const h = hooks({
      timeoutOf: () => HOUR,
      closeTerminal: vi.fn(async () => {
        throw new Error('runtime_unavailable')
      })
    })
    await pollRunningSteps(store, probe('working'), noCost, () => 2 * HOUR, h)
    expect(store.runs.steps('run-1')[0].status).toBe('running')
    expect(h.onStepEnded).not.toHaveBeenCalled()
  })

  // Stop (run-stop.ts) doesn't wait for the watcher: a step it ended while a probe was awaited keeps Stop's end.
  it.each<[string, ObservedState, Partial<StepPollHooks>]>([
    ['its tab then reads gone', 'gone', {}],
    ['its agent then reads done', 'done', {}],
    ['its timeout is due', 'working', { timeoutOf: () => 1 }],
    ['its wait: start session is up', 'working', { endsAtStart: () => true }]
  ])('leaves a step Stop ended mid-poll as Stop left it: %s', async (_n, state, over) => {
    const store = storeWithRunningStep()
    const stop = () =>
      store.runs.updateStep('run-1', 0, { status: 'failed', error: 'Stopped by you' })
    const status = vi.fn(async () => {
      stop()
      return state
    })
    const cost = vi.fn(async () => {
      stop()
      return { costUsd: null, tokens: 0 }
    })
    const h = hooks(over)
    await pollRunningSteps(
      store,
      { ...probe(state), status, started: () => true },
      cost,
      () => 9,
      h
    )
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'failed',
      error: 'Stopped by you',
      detached: false
    })
    expect(h.onStepEnded).not.toHaveBeenCalled()
    expect(h.closeTerminal).not.toHaveBeenCalled()
  })
})

describe('runtimeStepProbe.status', () => {
  function probeFor(
    show: () => Promise<unknown>,
    rows: unknown[] = [],
    relist: (handle: string, paneKey: string | null) => Promise<boolean> = async () => false
  ) {
    return runtimeStepProbe(
      {
        getAgentStatusRowsForPane: () => rows,
        showTerminal: show
      } as unknown as OrcaRuntimeService,
      relist
    )
  }
  const codeError = (code: string) =>
    Object.assign(new Error('prose about agent sessions'), { code })

  it.each([
    ['stale handle', new Error('terminal_handle_stale')],
    ['unknown handle', new Error('terminal_not_found')],
    [
      'structured-worker (agent-session) handle',
      codeError('terminal_unsupported_for_agent_session')
    ]
  ])('maps a %s to gone, fails the step and hands the run on', async (_name, error) => {
    const p = probeFor(async () => {
      throw error
    })
    expect(await p.status('h', 'pane')).toBe('gone')
    const store = storeWithRunningStep()
    const h = hooks()
    await pollRunningSteps(store, p, noCost, () => 9, h)
    expect(store.runs.steps('run-1')[0].status).toBe('failed')
    expect(h.onStepEnded).toHaveBeenCalledWith('run-1')
  })

  // Claude exited: the pane's rows are cleared and the terminal is orphaned, yet showTerminal still answers.
  describe('an orphaned, disconnected terminal', () => {
    const orphaned = async () => ({ orphaned: true, connected: false })

    it.each([
      ['relist cannot find it', false, 'gone'],
      ['relist finds it', true, 'working']
    ])('asks relist and answers by it (%s)', async (_name, found, expected) => {
      const relist = vi.fn(async () => found)
      const p = probeFor(orphaned, [], relist)
      expect(await p.status('h', 'pane')).toBe(expected)
      expect(relist).toHaveBeenCalledWith('h', 'pane')
    })

    it('fails the step with the closed-terminal message when gone', async () => {
      const store = storeWithRunningStep()
      const h = hooks()
      await pollRunningSteps(store, probeFor(orphaned), noCost, () => 9, h)
      const step = store.runs.steps('run-1')[0]
      expect(step.status).toBe('failed')
      expect(step.error).toBe('The terminal closed before the agent finished')
      expect(h.onStepEnded).toHaveBeenCalledWith('run-1')
    })

    it('logs and leaves the step running when relist cannot say', async () => {
      const p = probeFor(orphaned, [], async () => {
        throw new Error('terminal_liveness_unavailable')
      })
      const store = storeWithRunningStep()
      const h = hooks()
      await pollRunningSteps(store, p, noCost, () => 9, h)
      expect(store.runs.steps('run-1')[0].status).toBe('running')
      expect(h.log).toHaveBeenCalledWith(expect.stringContaining('terminal_liveness_unavailable'))
    })

    it('leaves a connected terminal working without asking relist', async () => {
      const relist = vi.fn(async () => false)
      const p = probeFor(async () => ({ orphaned: false, connected: true }), [], relist)
      expect(await p.status('h', 'pane')).toBe('working')
      expect(relist).not.toHaveBeenCalled()
    })
  })

  // After an app restart showTerminal calls a terminal the daemon still hosts stale; the PTY
  // host's inventory finds it again under its handle or pane, so the run stays open.
  it('keeps a step whose stale terminal the PTY host still lists (restart)', async () => {
    const relist = vi.fn(async () => true)
    const p = probeFor(
      async () => {
        throw new Error('terminal_handle_stale')
      },
      [],
      relist
    )
    expect(await p.status('h', 'pane')).toBe('working')
    expect(relist).toHaveBeenCalledWith('h', 'pane')
    const store = storeWithRunningStep()
    await pollRunningSteps(store, p, noCost, () => 9, hooks())
    expect(store.runs.steps('run-1')[0].status).toBe('running')
    expect(store.runs.runningCount('a')).toBe(1)
  })

  it("leaves the step open when the PTY host can't say (no liveness yet)", async () => {
    const p = probeFor(
      async () => {
        throw new Error('terminal_handle_stale')
      },
      [],
      async () => {
        throw new Error('terminal_liveness_unavailable')
      }
    )
    await expect(p.status('h', 'pane')).rejects.toThrow('terminal_liveness_unavailable')
    const store = storeWithRunningStep()
    await pollRunningSteps(store, p, noCost, () => 9, hooks())
    expect(store.runs.steps('run-1')[0].status).toBe('running')
  })

  it('rethrows a transient error so the step stays open', async () => {
    const p = probeFor(async () => {
      throw new Error('runtime_unavailable')
    })
    await expect(p.status('h', 'pane')).rejects.toThrow('runtime_unavailable')
    const store = storeWithRunningStep()
    await pollRunningSteps(store, p, noCost, () => 9, hooks())
    expect(store.runs.steps('run-1')[0].status).toBe('running')
    expect(store.runs.runningCount('a')).toBe(1)
  })

  it.each([
    [
      'a session-start done row',
      [{ state: 'done', sessionBoundary: true, receivedAt: 1 }],
      'working'
    ],
    ['a real done row', [{ state: 'done', receivedAt: 1 }], 'done'],
    [
      'the newest row',
      [
        { state: 'working', receivedAt: 5 },
        { state: 'done', receivedAt: 2 }
      ],
      'working'
    ]
  ])('reads %s', async (_n, rows, expected) => {
    const p = probeFor(async () => ({}), rows)
    expect(await p.status('h', 'pane')).toBe(expected)
  })

  // Background shells or Monitor watchers keep the row working + monitoring after the turn (agent-rows turnOver); a
  // turn's end is the step's end, as skills run in a Pilot step are told. The step began at 10.
  it.each<[string, Record<string, unknown>, ObservedState]>([
    ['its own turn over, background work from before the step running', {}, 'done'],
    ['its own turn over, background work it started running', { stateStartedAt: 12 }, 'done'],
    [
      'the prompt typed, no turn of its own reported yet',
      { mainAgent: { state: 'done', stateStartedAt: 5 } },
      'working'
    ],
    [
      'its turn still running beside the background work',
      { mainAgent: { state: 'working', stateStartedAt: 12 } },
      'working'
    ],
    ['its turn over, a task wake-up owed', { claudeTaskWakeupPending: 'notification' }, 'working'],
    ['a restored turn over, no live hook since', { restoredUnconfirmed: true }, 'working']
  ])('reads a step with a monitoring row, %s', async (_n, over, expected) => {
    const row = {
      state: 'working',
      workingMode: 'monitoring',
      mainAgent: { state: 'done', stateStartedAt: 15 },
      stateStartedAt: 3,
      receivedAt: 20,
      ...over
    }
    const p = probeFor(async () => ({}), [row])
    expect(await p.status('h', 'pane', 10)).toBe(expected)
  })

  it('ignores restoredUnconfirmed and provider-session-only rows, so a stale handle is gone', async () => {
    const rows = [
      { state: 'working', receivedAt: 9, restoredUnconfirmed: true },
      { state: 'working', receivedAt: 8, providerSessionOnly: true }
    ]
    const p = probeFor(async () => {
      throw new Error('terminal_handle_stale')
    }, rows)
    expect(await p.status('h', 'pane')).toBe('gone')
  })

  it('takes the session from the newest row that has one', () => {
    const p = probeFor(
      async () => ({}),
      [
        { state: 'working', receivedAt: 9 },
        { receivedAt: 3, providerSession: { id: 'old' } },
        { receivedAt: 4, providerSession: { id: 'new', transcriptPath: '/t' } }
      ]
    )
    expect(p.session('pane')).toEqual({ id: 'new', transcriptPath: '/t' })
  })

  it("never takes a session an earlier step's turn left in the tab", () => {
    const p = probeFor(
      async () => ({}),
      [
        { receivedAt: 3, providerSession: { id: 'previous' } },
        { receivedAt: 4, stateStartedAt: 20, providerSession: { id: 'mine' } }
      ]
    )
    expect(p.session('pane', 10)).toEqual({ id: 'mine', transcriptPath: null })
    expect(p.session('pane', 30)).toBeNull()
  })

  // A step sent into an earlier step's terminal: that turn's rows aren't this step's (Task 24 fix).
  it('reads only rows received since the step started, else asks the terminal', async () => {
    const show = vi.fn(async () => ({}))
    const p = probeFor(show, [{ state: 'done', receivedAt: 5 }])
    expect(await p.status('h', 'pane', 10)).toBe('working')
    expect(show).toHaveBeenCalledTimes(1)
    expect(await p.status('h', 'pane', 5)).toBe('done')
  })

  // The hook server re-stamps receivedAt on a same-state refresh, so a previous turn's done row can look new.
  it('ignores a re-stamped row of an earlier turn: its state started before the step', async () => {
    const show = vi.fn(async () => ({}))
    const p = probeFor(show, [{ state: 'done', stateStartedAt: 3, receivedAt: 20 }])
    expect(await p.status('h', 'pane', 10)).toBe('working')
    expect(show).toHaveBeenCalledTimes(1)
    const fresh = probeFor(show, [{ state: 'done', stateStartedAt: 12, receivedAt: 20 }])
    expect(await fresh.status('h', 'pane', 10)).toBe('done')
  })

  it('counts any live row since the step began as started, SessionStart included', () => {
    const started = (rows: object[], since?: number) =>
      probeFor(
        vi.fn(async () => ({})),
        rows
      ).started('pane', since)
    expect(started([])).toBe(false)
    expect(started([{ state: 'done', sessionBoundary: true, stateStartedAt: 12 }], 10)).toBe(true)
    expect(started([{ state: 'working', stateStartedAt: 3, receivedAt: 20 }], 10)).toBe(false)
    expect(started([{ state: 'working', receivedAt: 10 }], 10)).toBe(true)
    expect(started([{ state: 'working', providerSessionOnly: true, receivedAt: 20 }], 10)).toBe(
      false
    )
    expect(started([{ state: 'working', restoredUnconfirmed: true, receivedAt: 20 }], 10)).toBe(
      false
    )
  })

  it('reads the status row when there is one, without asking the terminal', async () => {
    const show = vi.fn(async () => ({}))
    const p = probeFor(show, [{ state: 'blocked' }])
    expect(await p.status('h', 'pane')).toBe('waiting')
    expect(show).not.toHaveBeenCalled()
  })
})
