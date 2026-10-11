import { appendFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parseAutomationYaml } from '../../shared/definition/parse'
import { PilotStore } from '../store/store'
import type { StepStartRequest } from './advance'
import { wireRunEngine } from './engine-wiring'
import { STALE_PENDING_MS, STALE_PENDING_OUTCOME } from './stale-starts'
import type { WorkspaceDeps } from './workspace'

const MIN = 60_000
const WORKSPACE: WorkspaceDeps = {
  listWorktrees: async () => [],
  createWorktree: async () => {
    throw new Error('createWorktree is not expected')
  },
  claimWorktree: () => {
    throw new Error('claimWorktree is not expected')
  }
}
const YAML = `name: Test UIs
repo: web-platform
schedule: manual
limits: { timeout: 60m }
steps:
  - { name: test, agent: codex, prompt: Test it, timeout: 10m }
  - { name: cleanup, agent: claude, prompt: Tidy up, always: true }
`

function definitionOf(yaml: string) {
  const parsed = parseAutomationYaml(yaml, '/a/test-uis.yaml')
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('\n'))
  }
  return parsed.definition
}

function setup(yaml = YAML) {
  const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-wiring-')), 'db.sqlite'))
  const def = definitionOf(yaml)
  const runtime = { closeTerminal: vi.fn(async () => ({})) }
  const started: StepStartRequest[] = []
  const wired = wireRunEngine({
    runtime: runtime as never,
    store,
    now: () => 11 * MIN,
    definitionFor: (id) => (id === def.id ? def : null),
    startAgentStep: async (req) => {
      started.push(req)
      const s = req.definition.steps[req.idx]
      store.runs.createStep({
        runId: req.run.id,
        idx: req.idx,
        name: s.name,
        agent: s.agent,
        skill: s.skill,
        startedAt: 11 * MIN
      })
      store.runs.updateStep(req.run.id, req.idx, {
        status: 'running',
        terminalHandle: `t${req.idx}`,
        paneKey: `p${req.idx}`
      })
    },
    workspace: WORKSPACE,
    engineEnv: { binDir: '/pilot/bin', dataDir: '/data/pilot' },
    shell: {
      workspaceOf: async () => ({ path: '/wt' }),
      envOf: () => ({}),
      run: async (spec) => {
        appendFileSync(String(spec.env.PILOT_OUTPUT_FILE), 'pruned=4\n')
        return { code: 0, signal: null, stdout: '', stderr: '', timedOut: false }
      }
    },
    probe: { status: async () => 'working' as const, session: () => null },
    cost: async () => ({ costUsd: null, tokens: 0 }),
    log: () => {}
  })
  store.runs.create({
    id: 'run-1',
    automationId: 'test-uis',
    tickId: null,
    itemKey: 'repo:web-platform',
    itemLabel: 'web-platform',
    worktreePath: '/wt',
    startedAt: 0
  })
  store.runs.createStep({
    runId: 'run-1',
    idx: 0,
    name: 'test',
    agent: 'codex',
    skill: null,
    startedAt: 0
  })
  store.runs.updateStep('run-1', 0, { status: 'running', terminalHandle: 't0', paneKey: 'p0' })
  return { store, runtime, started, wired }
}

describe('wireRunEngine', () => {
  it("advances the run when a shell step's process ends", async () => {
    const yaml =
      'name: Prune then tell\nrepo: web-platform\nschedule: manual\nsteps:\n  - { name: prune, agent: shell, run: ./prune.sh }\n  - { name: tell, agent: claude, prompt: "Pruned {steps.prune.pruned}" }\n'
    const { store, started, wired } = setup(yaml)
    store.runs.create({
      id: 'run-2',
      automationId: 'test-uis',
      tickId: null,
      itemKey: 'repo:web-platform',
      itemLabel: 'web-platform',
      worktreePath: '/wt',
      startedAt: 0
    })
    const definition = wired.definitionFor('test-uis')
    if (!definition) {
      throw new Error('setup')
    }
    const decision = {
      key: 'repo:web-platform',
      label: 'web-platform',
      verdict: 'started' as const,
      reason: '',
      checks: [],
      onceKey: 'repo:web-platform',
      fields: { 'repo.path': '/wt' }
    }
    await wired.engine.startRun({ runId: 'run-2', definition, decision })
    await wired.shell.settled()
    await vi.waitFor(() => expect(started.map((s) => [s.run.id, s.idx])).toEqual([['run-2', 1]]))
    expect(started[0].fields['steps.prune.pruned']).toBe(4)
  })

  it('closes a step past its own timeout through the runtime, then runs the always step', async () => {
    const { store, runtime, started, wired } = setup()
    await wired.poll()
    expect(runtime.closeTerminal).toHaveBeenCalledWith('t0')
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'timed_out',
      error: 'Timed out after 10m'
    })
    expect(started.map((s) => s.idx)).toEqual([1])
  })

  // As launch.ts's closeSessionTerminal: a process the close couldn't stop is a failed close, so the
  // step isn't timed out (and no next step starts beside a live agent) until a later poll closes it.
  it.each(['live', 'unverifiable'] as const)(
    'keeps a step past its timeout running while its process is %s',
    async (verdict) => {
      const { store, runtime, started, wired } = setup()
      runtime.closeTerminal.mockResolvedValueOnce({ ptyStopVerdict: verdict })
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
      await wired.poll()
      expect(store.runs.steps('run-1')[0].status).toBe('running')
      expect(started).toEqual([])
      expect(errors).toHaveBeenCalledWith(
        `pilot: couldn't poll step run-1/0: Couldn't close terminal t0: its process is ${verdict}`
      )
      await wired.poll()
      expect(store.runs.steps('run-1')[0].status).toBe('timed_out')
    }
  )

  it('leaves a step with no timeout at all running', async () => {
    const { store, runtime, wired } = setup(
      YAML.replace('limits: { timeout: 60m }\n', '').replace(', timeout: 10m', '')
    )
    await wired.poll()
    expect(runtime.closeTerminal).not.toHaveBeenCalled()
    expect(store.runs.steps('run-1')[0].status).toBe('running')
  })

  // B8 across the wiring: the sweep sees startRun's opening set, so a slow workspace never fails its run,
  // while a pending step no startRun holds (an app that stopped) is closed in the same poll.
  it('never closes the pending step of a run it is still opening, however long its workspace takes', async () => {
    const store = PilotStore.open(join(mkdtempSync(join(tmpdir(), 'pilot-wiring-')), 'db.sqlite'))
    const def = definitionOf(YAML)
    let clock = 0
    let listed: (() => void) | null = null
    const wired = wireRunEngine({
      runtime: { closeTerminal: vi.fn(async () => ({})) } as never,
      store,
      now: () => clock,
      definitionFor: (id) => (id === def.id ? def : null),
      startAgentStep: async (req) => {
        store.runs.updateStep(req.run.id, req.idx, {
          status: 'running',
          terminalHandle: 't',
          paneKey: 'p'
        })
      },
      engineEnv: { binDir: '/pilot/bin', dataDir: '/data/pilot' },
      shell: { workspaceOf: async () => ({ path: '/wt' }), envOf: () => ({}) },
      workspace: {
        ...WORKSPACE,
        listWorktrees: () => new Promise((resolve) => (listed = () => resolve([])))
      },
      probe: { status: async () => 'working' as const, session: () => null },
      log: () => {}
    })
    for (const id of ['slow', 'left']) {
      store.runs.create({
        id,
        automationId: 'test-uis',
        tickId: null,
        itemKey: id,
        itemLabel: id,
        worktreePath: null,
        startedAt: 0
      })
      store.markHandled('test-uis', `${id}:1`, id, 0)
    }
    store.runs.createStep({
      runId: 'left',
      idx: 0,
      name: 'test',
      agent: 'codex',
      skill: null,
      status: 'pending',
      startedAt: 0
    })
    const decision = {
      key: 'slow',
      label: 'slow',
      verdict: 'started' as const,
      reason: '',
      checks: [],
      onceKey: 'slow:1',
      fields: { 'repo.path': '/repo' }
    }
    const opening = wired.engine.startRun({ runId: 'slow', definition: def, decision })
    clock = 2 * STALE_PENDING_MS
    await wired.poll()
    expect(store.runs.steps('slow')[0].status).toBe('pending')
    expect(store.runs.get('left')).toMatchObject({
      status: 'failed',
      outcome: STALE_PENDING_OUTCOME
    })
    expect(store.handledKeys('test-uis')).toEqual(new Set(['slow:1']))
    listed!()
    await opening
    expect(store.runs.steps('slow')[0].status).toBe('running')
    expect(store.runs.get('slow')).toMatchObject({ status: 'running', worktreePath: '/repo' })
  })
})
