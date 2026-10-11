import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { PilotStore } from '../store/store'
import { pollRunningSteps, runtimeStepProbe, type StepProbe } from './watcher'

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

const probe = (state: 'working' | 'waiting' | 'done' | 'gone'): StepProbe => ({
  status: async () => state,
  session: () => ({ id: 'sess-1', transcriptPath: '/t/sess-1.jsonl' })
})
const noCost = async () => ({ costUsd: null, tokens: 0 })

describe('pollRunningSteps', () => {
  it('records the session id while the agent works', async () => {
    const store = storeWithRunningStep()
    await pollRunningSteps(
      store,
      probe('working'),
      async () => ({ costUsd: 0, tokens: 0 }),
      () => 5
    )
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'running',
      sessionId: 'sess-1',
      transcriptPath: '/t/sess-1.jsonl'
    })
  })

  it('finishes the step and the run with cost when the agent is done', async () => {
    const store = storeWithRunningStep()
    await pollRunningSteps(
      store,
      probe('done'),
      async () => ({ costUsd: 1.95, tokens: 120000 }),
      () => 9
    )
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'done',
      costUsd: 1.95,
      tokens: 120000,
      finishedAt: 9
    })
    expect(store.runs.runningCount('a')).toBe(0)
  })

  it('fails the run when its terminal is gone before the agent finished', async () => {
    const store = storeWithRunningStep()
    await pollRunningSteps(store, probe('gone'), noCost, () => 9)
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'failed',
      error: 'The terminal closed before the agent finished'
    })
    expect(store.runs.runningCount('a')).toBe(0)
  })

  it('retries next poll when the run update throws, leaving the step open', async () => {
    const store = storeWithRunningStep()
    const real = store.runs.update.bind(store.runs)
    let fail = true
    store.runs.update = (id, patch) => {
      if (fail) {
        throw new Error('db busy')
      }
      real(id, patch)
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await pollRunningSteps(store, probe('done'), noCost, () => 9)
    expect(store.runs.steps('run-1')[0].status).toBe('running')
    fail = false
    await pollRunningSteps(store, probe('done'), noCost, () => 9)
    expect(store.runs.steps('run-1')[0].status).toBe('done')
    expect(store.runs.runningCount('a')).toBe(0)
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
    await pollRunningSteps(store, flaky, noCost, () => 9)
    expect(store.runs.steps('run-1')[0].status).toBe('running')
    expect(store.runs.steps('run-2')[0].status).toBe('done')
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
  ])('maps a %s to gone and closes the step and run', async (_name, error) => {
    const p = probeFor(async () => {
      throw error
    })
    expect(await p.status('h', 'pane')).toBe('gone')
    const store = storeWithRunningStep()
    await pollRunningSteps(store, p, noCost, () => 9)
    expect(store.runs.steps('run-1')[0].status).toBe('failed')
    expect(store.runs.runningCount('a')).toBe(0)
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
    await pollRunningSteps(store, p, noCost, () => 9)
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
    await pollRunningSteps(store, p, noCost, () => 9)
    expect(store.runs.steps('run-1')[0].status).toBe('running')
  })

  it('rethrows a transient error so the step stays open', async () => {
    const p = probeFor(async () => {
      throw new Error('runtime_unavailable')
    })
    await expect(p.status('h', 'pane')).rejects.toThrow('runtime_unavailable')
    const store = storeWithRunningStep()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await pollRunningSteps(store, p, noCost, () => 9)
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

  it('reads the status row when there is one, without asking the terminal', async () => {
    const show = vi.fn(async () => ({}))
    const p = probeFor(show, [{ state: 'blocked' }])
    expect(await p.status('h', 'pane')).toBe('waiting')
    expect(show).not.toHaveBeenCalled()
  })
})
