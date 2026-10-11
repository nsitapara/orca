import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { ItemDecision } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import { UnrecordedLaunchError } from '../scheduler/tick-runner'
import { PilotStore } from '../store/store'
import type { PilotAgentLaunchOptions } from './agent-launch-hook'
import {
  makeLauncher,
  openAgentTerminal,
  runtimeLauncherDeps,
  type AgentTerminalRequest,
  type LauncherDeps
} from './launch'
import { STALE_START_MS, sweepStaleStarts } from './stale-starts'

const def = testDefinition({
  id: 'fix-failed-ci',
  name: 'Fix failed CI on my MRs',
  powers: ['commit', 'push'],
  steps: [
    testStep({
      name: 'fix',
      skill: 'fix-gitlab-ci',
      prompt: 'Fix pipeline {mr.pipeline} on !{mr.iid}.'
    })
  ]
})
const decisionWith = (fields: ItemDecision['fields']): ItemDecision => ({
  key: 'mr:1561',
  label: '!1561 web-1493',
  verdict: 'started',
  reason: '',
  checks: [],
  onceKey: '',
  fields: { 'repo.path': '/repo', ...fields }
})
const decision = decisionWith({
  'mr.iid': 1561,
  'mr.pipeline': 99,
  'worktree.path': '/wt',
  'worktree.id': 'r1::/wt'
})
const STARTED = Date.UTC(2026, 9, 11, 19, 0)

type Launch = (
  selector: string,
  opts: PilotAgentLaunchOptions
) => Promise<{ handle: string; paneKey?: string | null }>
const ok: Launch = async () => ({ handle: 'term_1', paneKey: 'tab:leaf' })

function setup(launch: Launch, over: Partial<LauncherDeps> = {}) {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'run-1',
    automationId: 'fix-failed-ci',
    tickId: null,
    itemKey: 'mr:1561',
    itemLabel: '!1561 web-1493',
    worktreePath: null,
    startedAt: STARTED
  })
  const created: string[] = []
  const stepAtCreate: string[] = []
  const deps: LauncherDeps = {
    workspace: {
      listWorktrees: async () => [
        { id: 'r1::/repo', path: '/repo', branch: 'dev', head: 'h', linkedLinearIssue: null }
      ],
      createWorktree: async (req) => {
        created.push(req.name)
        stepAtCreate.push(store.runs.steps('run-1')[0]?.status ?? 'no step')
        return { id: `r1::/wt/${req.name}`, path: `/wt/${req.name}` }
      },
      claimWorktree: () => true
    },
    launchTerminal: vi.fn(launch),
    modeText: async () => null,
    newSessionId: () => 'sess-pinned',
    now: () => 7,
    ...over
  }
  return { store, deps, created, stepAtCreate, launcher: makeLauncher(store, deps) }
}
const request = (definition: AutomationDefinition = def, d: ItemDecision = decision) => ({
  runId: 'run-1',
  definition,
  decision: d
})

describe('makeLauncher', () => {
  it('starts the first step in the item worktree with its env, pinned session and prompt, and records both', async () => {
    const { store, deps, launcher } = setup(ok)
    expect(await launcher(request())).toEqual({ terminalHandle: 'term_1', paneKey: 'tab:leaf' })
    expect(vi.mocked(deps.launchTerminal).mock.calls[0]).toEqual([
      'id:r1::/wt',
      {
        agent: 'claude',
        prompt: [
          'Started by the Pilot automation "Fix failed CI on my MRs" (run run-1) for !1561 web-1493.',
          'Use the fix-gitlab-ci skill.',
          '',
          'Fix pipeline 99 on !1561.'
        ].join('\n'),
        title: 'Fix failed CI on my MRs · !1561 web-1493',
        pilot: {
          env: {
            PILOT_RUN_ID: 'run-1',
            PILOT_STEP: 'fix',
            PILOT_STEP_IDX: '0',
            PILOT_AUTOMATION_ID: 'fix-failed-ci',
            PILOT_ITEM_KEY: 'mr:1561',
            PILOT_POWERS: 'commit,push',
            AGENT_RUN: 'run-1'
          },
          argv: ['--session-id', 'sess-pinned']
        }
      }
    ])
    expect(store.runs.get('run-1')?.worktreePath).toBe('/wt')
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'running',
      terminalHandle: 'term_1',
      paneKey: 'tab:leaf',
      sessionId: 'sess-pinned',
      startedAt: 7
    })
  })

  it("fails step 0 with the item's label when it has no worktree", async () => {
    const { store, launcher } = setup(ok)
    await expect(launcher(request(def, decisionWith({ 'worktree.path': null })))).rejects.toThrow(
      'No worktree for !1561 web-1493'
    )
    expect(store.runs.steps('run-1')).toHaveLength(1)
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      name: 'fix',
      status: 'failed',
      error: 'No worktree for !1561 web-1493'
    })
  })

  it('says the worktree is gone when the runtime no longer lists it', async () => {
    const { store, launcher } = setup(async () => {
      throw new Error('selector_not_found')
    })
    await expect(launcher(request())).rejects.toThrow('worktree is gone')
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'failed',
      error: 'worktree is gone'
    })
  })

  it('runs in the main checkout, by its worktree id', async () => {
    const { store, deps, launcher } = setup(ok)
    await launcher(request(testDefinition({ ...def, workspace: { kind: 'main_checkout' } })))
    expect(vi.mocked(deps.launchTerminal).mock.calls[0][0]).toBe('id:r1::/repo')
    expect(store.runs.get('run-1')?.worktreePath).toBe('/repo')
  })

  it("creates a new worktree named from the run's date and records it on the run", async () => {
    const { store, deps, created, launcher } = setup(ok)
    const memo = testDefinition({
      ...def,
      workspace: {
        kind: 'new_worktree',
        base: 'origin/dev',
        name: 'memo-{run.date}',
        reuseExisting: false,
        setup: 'skip'
      }
    })
    await launcher(request(memo))
    expect(created).toEqual(['memo-20261011'])
    expect(vi.mocked(deps.launchTerminal).mock.calls[0][0]).toBe('id:r1::/wt/memo-20261011')
    expect(store.runs.get('run-1')?.worktreePath).toBe('/wt/memo-20261011')
  })

  // B8: the stale-start sweep only closes `starting` steps, so a slow create must not look like one.
  it('keeps step 0 pending while its new worktree is being made, then starts it', async () => {
    const { store, stepAtCreate, launcher } = setup(ok)
    const memo = testDefinition({
      ...def,
      workspace: {
        kind: 'new_worktree',
        base: 'origin/dev',
        name: 'memo-{run.date}',
        reuseExisting: false,
        setup: 'skip'
      }
    })
    await launcher(request(memo))
    expect(stepAtCreate).toEqual(['pending'])
    expect(store.runs.steps('run-1')).toHaveLength(1)
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'running',
      terminalHandle: 'term_1'
    })
  })

  it('fails step 0 with the error when the new worktree cannot be created', async () => {
    const failing = {
      listWorktrees: async () => [],
      createWorktree: async () => {
        throw new Error('git worktree add failed')
      },
      claimWorktree: () => true
    }
    const { store, deps, launcher } = setup(ok, { workspace: failing })
    const memo = testDefinition({
      ...def,
      workspace: {
        kind: 'new_worktree',
        base: 'origin/dev',
        name: 'memo-{run.date}',
        reuseExisting: false,
        setup: 'skip'
      }
    })
    await expect(launcher(request(memo))).rejects.toThrow('git worktree add failed')
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'failed',
      error: 'git worktree add failed'
    })
    expect(vi.mocked(deps.launchTerminal)).not.toHaveBeenCalled()
  })

  it('hands a shell first step to the shell runner, and refuses it without one', async () => {
    const shellFirst = testDefinition({
      ...def,
      steps: [testStep({ name: 'pull', agent: 'shell', prompt: null, run: 'git pull' })]
    })
    const without = setup(ok)
    await expect(without.launcher(request(shellFirst))).rejects.toThrow(
      'Step "pull" is a shell step'
    )
    expect(without.store.runs.steps('run-1')[0]).toMatchObject({ kind: 'shell', status: 'failed' })
    const startShellStep = vi.fn(async () => ({ terminalHandle: '', paneKey: '' }))
    const withRunner = setup(ok, { startShellStep })
    await withRunner.launcher(request(shellFirst))
    expect(startShellStep).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1', stepIdx: 0 })
    )
    expect(vi.mocked(withRunner.deps.launchTerminal)).not.toHaveBeenCalled()
  })

  it('leaves a step the sweep closed failed when its launch completes late', async () => {
    let finish: (t: { handle: string; paneKey: string }) => void = () => {}
    const { store, launcher } = setup(() => new Promise((resolve) => (finish = resolve)))
    const late = launcher(request())
    await vi.waitFor(() => expect(store.runs.steps('run-1')[0]?.status).toBe('starting'))
    sweepStaleStarts(
      store,
      () => 7 + STALE_START_MS + 1,
      () => {}
    )
    finish({ handle: 'term_3', paneKey: 'p' })
    await expect(late).rejects.toThrow(/term_3.*closed before its agent started/)
    expect(store.runs.steps('run-1')[0]).toMatchObject({ status: 'failed', terminalHandle: null })
  })

  it('names the orphaned terminal when it cannot record the step after launching', async () => {
    const { store, launcher } = setup(async () => ({ handle: 'term_9', paneKey: 'p' }))
    store.runs.updateStartingStep = () => {
      throw new Error('disk full')
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = await launcher(request()).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(UnrecordedLaunchError)
    expect(failure).toMatchObject({
      terminalHandle: 'term_9',
      message: expect.stringMatching(/term_9.*disk full/)
    })
    expect(store.runs.steps('run-1')[0]).toMatchObject({ status: 'failed' })
  })
})

const idleWorktrees = {
  listWorktrees: async () => [],
  terminalAlive: async () => true,
  paneState: () => 'idle' as const,
  terminalDraft: async () => ''
}
const runs = () => PilotStore.open(':memory:').runs
// The runtime's own answer to "is an agent still running in this terminal" (upstream's send guard reads it).
const agentRunning = (isRunningAgent: boolean) =>
  ({
    getTerminalAgentStatus: async (handle: string) => ({ handle, isRunningAgent, status: null })
  }) as unknown as OrcaRuntimeService

describe('runtimeLauncherDeps', () => {
  it("passes Pilot's launch options to the runtime unchanged, and refuses a mode until modes load", async () => {
    const launchAgentTerminal = vi.fn(async () => ({ handle: 't', paneKey: 'p' }))
    const runtime = { launchAgentTerminal } as unknown as OrcaRuntimeService
    const deps = runtimeLauncherDeps(runtime, idleWorktrees, () => 1, runs())
    const opts: PilotAgentLaunchOptions = {
      agent: 'codex',
      prompt: 'x',
      pilot: { env: { A: '1' }, argv: [] }
    }
    await deps.launchTerminal('id:w', opts)
    expect(launchAgentTerminal).toHaveBeenCalledWith('id:w', opts)
    expect(await deps.modeText(testStep(), '/wt')).toBeNull()
    await expect(deps.modeText(testStep({ name: 'fix', mode: 'answers' }), '/wt')).rejects.toThrow(
      'mode "answers"'
    )
    expect(deps.newSessionId()).toMatch(/^[0-9a-f-]{36}$/)
  })

  // H10: only a live, idle terminal with an empty draft (read from the rendered screen) takes the prompt.
  it.each([
    ['live, idle, empty draft', idleWorktrees, 'p', true],
    ['no pane to watch', idleWorktrees, null, false],
    ['gone', { ...idleWorktrees, terminalAlive: async () => false }, 'p', false],
    ['working', { ...idleWorktrees, paneState: () => 'working' as const }, 'p', false],
    ['waiting for input', { ...idleWorktrees, paneState: () => 'waiting' as const }, 'p', false],
    [
      'someone typing',
      { ...idleWorktrees, terminalDraft: async () => 'half a prompt' },
      'p',
      false
    ],
    [
      'unreadable',
      {
        ...idleWorktrees,
        terminalDraft: async () => {
          throw new Error('terminal_handle_stale')
        }
      },
      'p',
      false
    ]
  ])('resumeTarget: %s', async (_name, worktrees, paneKey, expected) => {
    const deps = runtimeLauncherDeps(agentRunning(true), worktrees, () => 1, runs())
    expect(await deps.resumeTarget?.('t', paneKey)).toBe(expected)
  })

  // A terminal whose agent exited is a bare shell (no hook row, so its pane reads idle): a prompt typed
  // there would run as shell commands.
  it('resumeTarget: not when the agent has exited and left a shell', async () => {
    const deps = runtimeLauncherDeps(agentRunning(false), idleWorktrees, () => 1, runs())
    expect(await deps.resumeTarget?.('t', 'p')).toBe(false)
  })

  it('sendPrompt types the prompt and fails when no turn starts', async () => {
    const sendTerminalAgentPrompt = vi
      .fn()
      .mockResolvedValueOnce({
        accepted: true,
        prompt: { stages: ['input_accepted', 'turn_started'] }
      })
      .mockResolvedValueOnce({ accepted: true, prompt: { stages: ['input_accepted'] } })
    const deps = runtimeLauncherDeps(
      { sendTerminalAgentPrompt } as unknown as OrcaRuntimeService,
      idleWorktrees,
      () => 1,
      runs()
    )
    await deps.sendPrompt?.('t', 'go')
    expect(sendTerminalAgentPrompt).toHaveBeenCalledWith('t', 'go', {
      inputKind: 'driving',
      observationTimeoutMs: 30_000
    })
    await expect(deps.sendPrompt?.('t', 'go')).rejects.toThrow("didn't start a turn")
  })
})

describe('openAgentTerminal', () => {
  const base: Omit<AgentTerminalRequest, 'agent' | 'session'> = {
    runId: 'ans-1',
    stepIdx: 0,
    stepName: 'answers',
    automationId: 'apply',
    itemKey: 'mr:1561',
    powers: ['commit'],
    worktree: { id: 'r1::/wt', path: '/wt' },
    prompt: 'Apply the answers.',
    title: 'Apply · answers',
    args: []
  }

  it.each<
    [
      string,
      AgentTerminalRequest['agent'],
      AgentTerminalRequest['session'],
      string[],
      string | null
    ]
  >([
    [
      'a new Claude session is pinned',
      'claude',
      { kind: 'new' },
      ['--session-id', 'uuid-9'],
      'uuid-9'
    ],
    ['a new Codex session is learned from its hooks', 'codex', { kind: 'new' }, [], null],
    ['resume', 'claude', { kind: 'resume', sessionId: 's-1' }, ['--resume', 's-1'], 's-1'],
    [
      'a Claude fork',
      'claude',
      { kind: 'fork', sessionId: 's-1' },
      ['--resume', 's-1', '--fork-session'],
      null
    ],
    ['a Codex fork', 'codex', { kind: 'fork', sessionId: 's-2' }, ['fork', 's-2'], null]
  ])('%s', async (_name, agent, session, argv, sessionId) => {
    const launchAgentTerminal = vi.fn(async () => ({ handle: 'term_7', paneKey: 'tab:leaf' }))
    const runtime = { launchAgentTerminal } as unknown as OrcaRuntimeService
    const result = await openAgentTerminal(runtime, { ...base, agent, session }, () => 'uuid-9')
    expect(launchAgentTerminal).toHaveBeenCalledWith('id:r1::/wt', {
      agent,
      prompt: 'Apply the answers.',
      title: 'Apply · answers',
      pilot: {
        env: {
          PILOT_RUN_ID: 'ans-1',
          PILOT_STEP: 'answers',
          PILOT_STEP_IDX: '0',
          PILOT_AUTOMATION_ID: 'apply',
          PILOT_ITEM_KEY: 'mr:1561',
          PILOT_POWERS: 'commit',
          AGENT_RUN: 'ans-1'
        },
        argv
      }
    })
    expect(result).toEqual({ terminalHandle: 'term_7', paneKey: 'tab:leaf', sessionId })
  })

  it('selects the worktree by path when it has no id, and fails when the runtime returns no pane', async () => {
    const launchAgentTerminal = vi.fn(async (_selector: string) => ({ handle: 'term_8' }))
    const runtime = { launchAgentTerminal } as unknown as OrcaRuntimeService
    await expect(
      openAgentTerminal(runtime, {
        ...base,
        agent: 'claude',
        session: { kind: 'new' },
        worktree: { id: null, path: '/wt' }
      })
    ).rejects.toThrow('no pane to watch')
    expect(launchAgentTerminal.mock.calls[0][0]).toBe('path:/wt')
  })
})
