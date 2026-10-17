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

const probe = (state: ObservedState): StepProbe => ({
  status: async () => state,
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
    vi.spyOn(console, 'error').mockImplementation(() => {})
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
      status: async (handle) => {
        if (handle === 'bad') {
          throw new Error('runtime_unavailable')
        }
        return 'done'
      },
      session: () => null
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await pollRunningSteps(store, flaky, noCost, () => 9, hooks())
    expect(store.runs.steps('run-1')[0].status).toBe('running')
    expect(store.runs.steps('run-2')[0].status).toBe('done')
  })

  // The step started at 1 (addRunningStep); "now" is 1 + elapsed.
  it.each([
    ['working past its timeout', 'working', HOUR, 'timed_out', 'Timed out after 60m'],
    [
      'waiting past its timeout',
      'waiting',
      HOUR,
      'timed_out',
      'Timed out after 60m while it waited in its tab'
    ],
    ['working within its timeout', 'working', HOUR - 1, 'running', null],
    ['done exactly at its timeout', 'done', HOUR, 'done', null]
  ] as const)('a step %s', async (_name, state, elapsed, status, error) => {
    const store = storeWithRunningStep()
    const h = hooks({ timeoutOf: () => HOUR })
    await pollRunningSteps(store, probe(state), noCost, () => 1 + elapsed, h)
    expect(store.runs.steps('run-1')[0]).toMatchObject({ status, ...(error ? { error } : {}) })
    expect(h.closeTerminal).toHaveBeenCalledTimes(status === 'timed_out' ? 1 : 0)
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
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await pollRunningSteps(store, probe('working'), noCost, () => 2 * HOUR, h)
    expect(store.runs.steps('run-1')[0].status).toBe('running')
    expect(h.onStepEnded).not.toHaveBeenCalled()
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
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await pollRunningSteps(store, p, noCost, () => 9, hooks())
    expect(store.runs.steps('run-1')[0].status).toBe('running')
  })

  it('rethrows a transient error so the step stays open', async () => {
    const p = probeFor(async () => {
      throw new Error('runtime_unavailable')
    })
    await expect(p.status('h', 'pane')).rejects.toThrow('runtime_unavailable')
    const store = storeWithRunningStep()
    vi.spyOn(console, 'error').mockImplementation(() => {})
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

  it('reads the status row when there is one, without asking the terminal', async () => {
    const show = vi.fn(async () => ({}))
    const p = probeFor(show, [{ state: 'blocked' }])
    expect(await p.status('h', 'pane')).toBe('waiting')
    expect(show).not.toHaveBeenCalled()
  })
})
