import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { ItemDecision } from '../../shared/api-types'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import type { WorktreeFactDeps } from '../fields/worktree-facts'
import { UnrecordedLaunchError } from '../scheduler/tick-runner'
import { PilotStore } from '../store/store'
import type { PilotAgentLaunchOptions } from './agent-launch-hook'
import { PromptNotSentError, type SessionTerminalState } from './agent-step'
import {
  openAgentTerminal,
  runtimeLauncherDeps,
  type AgentTerminalRequest,
  type LauncherDeps
} from './launch'
import { STALE_START_MS, sweepStaleStarts } from './stale-starts'
import { makeLauncher } from './__fixtures__/launcher'

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
  const stepAtCreate: { status: string; startedAt: number | null }[] = []
  const deps: LauncherDeps = {
    workspace: {
      listWorktrees: async () => [
        { id: 'r1::/repo', path: '/repo', branch: 'dev', head: 'h', linkedLinearIssue: null }
      ],
      createWorktree: async (req) => {
        created.push(req.name)
        const step = store.runs.steps('run-1')[0]
        stepAtCreate.push({ status: step?.status ?? 'no step', startedAt: step?.startedAt ?? null })
        return { id: `r1::/wt/${req.name}`, path: `/wt/${req.name}` }
      },
      claimWorktree: () => true
    },
    launchTerminal: vi.fn(launch),
    modeText: async () => null,
    newSessionId: () => '00000000-0000-4000-8000-000000000013',
    now: () => 7,
    transcriptExists: async () => true,
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
            PILOT_POWERS: 'commit,push'
          },
          argv: [
            '--prompt-suggestions=false',
            '--session-id',
            '00000000-0000-4000-8000-000000000013'
          ]
        }
      }
    ])
    expect(store.runs.get('run-1')?.worktreePath).toBe('/wt')
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'running',
      terminalHandle: 'term_1',
      paneKey: 'tab:leaf',
      sessionId: '00000000-0000-4000-8000-000000000013',
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
    // Stamped when the run began opening it, as the run engine does; launchAgentStep re-stamps it.
    expect(stepAtCreate).toEqual([{ status: 'pending', startedAt: 7 }])
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

const idleWorktrees: Pick<
  WorktreeFactDeps,
  'listWorktrees' | 'terminalAlive' | 'paneState' | 'terminalDraft'
> = {
  listWorktrees: async () => [],
  terminalAlive: async () => true,
  paneState: () => 'idle',
  terminalDraft: async () => ''
}
const runs = () => PilotStore.open(':memory:').runs
const throwing = async (): Promise<never> => {
  throw new Error('runtime_unavailable')
}
type AgentLook = {
  running?: boolean
  // Successive answers to "is an agent in the foreground" (an Error: that read fails); the last repeats.
  reads?: (boolean | Error)[]
  status?: 'working' | 'permission' | 'idle' | null
  session?: string | null
  unreadable?: boolean
}
const noPause = async () => {}
// The runtime's view of a terminal: whether an agent is in the foreground and its state (what
// upstream's send guard reads), and the session the pane's hooks report.
function runtimeSeeing(look: AgentLook = {}, more: Record<string, unknown> = {}) {
  const session = 'session' in look ? look.session : '00000000-0000-4000-8000-000000000011'
  const reads = look.reads ?? [look.running ?? true]
  let read = 0
  return {
    getTerminalAgentStatus: async (handle: string) => {
      const running = reads[Math.min(read++, reads.length - 1)]
      if (look.unreadable) {
        throw new Error('terminal_handle_stale')
      }
      if (running instanceof Error) {
        throw running
      }
      const status = 'status' in look ? look.status : 'idle'
      return { handle, isRunningAgent: running, status }
    },
    getAgentStatusRowsForPane: () =>
      session ? [{ receivedAt: 1, providerSession: { key: 'session_id', id: session } }] : [],
    ...more
  } as unknown as OrcaRuntimeService
}

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

  // H10: what the terminal a session last ran in can take. The draft is read from the rendered
  // screen (B6); anything unreadable is busy, never gone.
  it.each<[string, Partial<typeof idleWorktrees>, AgentLook, string | null, SessionTerminalState]>([
    ['an idle agent running this session, nobody typing', {}, {}, 'p', 'free'],
    [
      'an idle agent running another session',
      {},
      { session: '00000000-0000-4000-8000-000000000012' },
      'p',
      'other'
    ],
    ['an idle agent whose session is unknown', {}, { session: null }, 'p', 'other'],
    ['closed', { terminalAlive: async () => false }, {}, 'p', 'gone'],
    ['an agent that exited, leaving a shell', {}, { running: false }, 'p', 'gone'],
    ['a working agent', {}, { status: 'working' }, 'p', 'busy'],
    ['an agent at a permission prompt', {}, { status: 'permission' }, 'p', 'busy'],
    ['an agent working by its hooks', { paneState: () => 'working' }, {}, 'p', 'busy'],
    ['an agent waiting for input by its hooks', { paneState: () => 'waiting' }, {}, 'p', 'busy'],
    ['someone typing', { terminalDraft: async () => 'half a prompt' }, {}, 'p', 'busy'],
    ['no pane to read', {}, {}, null, 'busy'],
    ['unreadable liveness', { terminalAlive: throwing }, {}, 'p', 'busy'],
    ['an unreadable agent status', {}, { unreadable: true }, 'p', 'busy'],
    ['an unreadable draft', { terminalDraft: throwing }, {}, 'p', 'busy']
  ])('sessionTerminals.state: %s', async (_name, worktrees, look, paneKey, expected) => {
    const seen = { ...idleWorktrees, ...worktrees }
    const deps = runtimeLauncherDeps(runtimeSeeing(look), seen, () => 1, runs(), noPause)
    expect(
      await deps.sessionTerminals?.state(
        { handle: 't', paneKey },
        '00000000-0000-4000-8000-000000000011'
      )
    ).toBe(expected)
  })

  // Title and foreground caches lag, so "its agent exited" needs fresh evidence for about a second, as
  // upstream's send guard asks (150 ms apart); a read that fails on the way is busy.
  it.each<[string, (boolean | Error)[], SessionTerminalState, number]>([
    ['no agent on the first read, one on the next: not gone', [false, true], 'free', 1],
    ['no agent on any read for about a second: gone', [false], 'gone', 7],
    ['no agent, then a failed read: busy', [false, new Error('terminal_handle_stale')], 'busy', 1]
  ])(
    'sessionTerminals.state re-polls a missing agent: %s',
    async (_name, reads, expected, waits) => {
      const pause = vi.fn(async (_ms: number) => {})
      const runtime = runtimeSeeing({ reads })
      const deps = runtimeLauncherDeps(runtime, idleWorktrees, () => 1, runs(), pause)
      expect(
        await deps.sessionTerminals?.state(
          { handle: 't', paneKey: 'p' },
          '00000000-0000-4000-8000-000000000011'
        )
      ).toBe(expected)
      expect(pause.mock.calls).toEqual(Array.from({ length: waits }, () => [150]))
    }
  )

  // S1: the prompt carries item text (MR, branch, Linear), so it is typed only while an idle agent is
  // in the foreground, read again right before sending: never into a shell or a permission dialog.
  it.each<[string, AgentLook]>([
    ['its agent exited', { running: false }],
    ['its agent is working', { status: 'working' }],
    ['its agent is at a permission prompt', { status: 'permission' }]
  ])('sessionTerminals.send refuses, typing nothing, when %s', async (_name, look) => {
    const sendTerminalAgentPrompt = vi.fn()
    const runtime = runtimeSeeing(look, { sendTerminalAgentPrompt })
    const deps = runtimeLauncherDeps(runtime, idleWorktrees, () => 1, runs())
    const refused = deps.sessionTerminals?.send('t', 'go')
    await expect(refused).rejects.toThrow('no idle agent')
    await expect(refused).rejects.toBeInstanceOf(PromptNotSentError)
    expect(sendTerminalAgentPrompt).not.toHaveBeenCalled()
  })

  // Task 24 fix: an answers dispatch must know whether the prompt may have reached the agent.
  it('sessionTerminals.send says nothing was typed when the runtime refuses the prompt, and not when no turn starts', async () => {
    const sendTerminalAgentPrompt = vi
      .fn()
      .mockResolvedValueOnce({ accepted: false, refusedReason: 'permission' })
      .mockResolvedValueOnce({ accepted: true, prompt: { stages: ['input_accepted'] } })
    const runtime = runtimeSeeing({}, { sendTerminalAgentPrompt })
    const deps = runtimeLauncherDeps(runtime, idleWorktrees, () => 1, runs())
    await expect(deps.sessionTerminals?.send('t', 'go')).rejects.toBeInstanceOf(PromptNotSentError)
    const unconfirmed = deps.sessionTerminals?.send('t', 'go')
    await expect(unconfirmed).rejects.toThrow("didn't start a turn")
    await expect(unconfirmed).rejects.not.toBeInstanceOf(PromptNotSentError)
  })

  it('sessionTerminals.send types the prompt as the driver, and fails when no turn starts', async () => {
    const sendTerminalAgentPrompt = vi
      .fn()
      .mockResolvedValueOnce({
        accepted: true,
        prompt: { stages: ['input_accepted', 'turn_started'] }
      })
      .mockResolvedValueOnce({ accepted: true, prompt: { stages: ['input_accepted'] } })
    const runtime = runtimeSeeing({}, { sendTerminalAgentPrompt })
    const deps = runtimeLauncherDeps(runtime, idleWorktrees, () => 1, runs())
    await deps.sessionTerminals?.send('t', 'go')
    expect(sendTerminalAgentPrompt).toHaveBeenCalledWith('t', 'go', {
      inputKind: 'driving',
      observationTimeoutMs: 30_000
    })
    await expect(deps.sessionTerminals?.send('t', 'go')).rejects.toThrow("didn't start a turn")
  })

  it('sessionTerminals.close closes the tab, and fails when its process may still run', async () => {
    const closeTerminal = vi
      .fn()
      .mockResolvedValueOnce({ handle: 't', tabId: 'tab', ptyKilled: true })
      .mockResolvedValueOnce({
        handle: 't',
        tabId: 'tab',
        ptyKilled: false,
        ptyStopVerdict: 'live'
      })
    const runtime = { closeTerminal } as unknown as OrcaRuntimeService
    const deps = runtimeLauncherDeps(runtime, idleWorktrees, () => 1, runs())
    await deps.sessionTerminals?.close('t')
    expect(closeTerminal).toHaveBeenCalledWith('t')
    await expect(deps.sessionTerminals?.close('t')).rejects.toThrow(
      "Couldn't close terminal t: its process is live"
    )
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
      ['--prompt-suggestions=false', '--session-id', '00000000-0000-4000-8000-000000000019'],
      '00000000-0000-4000-8000-000000000019'
    ],
    ['a new Codex session is learned from its hooks', 'codex', { kind: 'new' }, [], null],
    [
      'resume',
      'claude',
      { kind: 'resume', sessionId: '00000000-0000-4000-8000-000000000011' },
      ['--prompt-suggestions=false', '--resume', '00000000-0000-4000-8000-000000000011'],
      '00000000-0000-4000-8000-000000000011'
    ],
    [
      'a Claude fork',
      'claude',
      { kind: 'fork', sessionId: '00000000-0000-4000-8000-000000000011' },
      [
        '--prompt-suggestions=false',
        '--resume',
        '00000000-0000-4000-8000-000000000011',
        '--fork-session'
      ],
      null
    ],
    [
      'a Codex fork',
      'codex',
      { kind: 'fork', sessionId: '00000000-0000-4000-8000-000000000012' },
      ['fork', '00000000-0000-4000-8000-000000000012'],
      null
    ]
  ])('%s', async (_name, agent, session, argv, sessionId) => {
    const launchAgentTerminal = vi.fn(async () => ({ handle: 'term_7', paneKey: 'tab:leaf' }))
    const runtime = { launchAgentTerminal } as unknown as OrcaRuntimeService
    const result = await openAgentTerminal(
      runtime,
      { ...base, agent, session },
      () => '00000000-0000-4000-8000-000000000019'
    )
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
          PILOT_POWERS: 'commit'
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
    ).rejects.toMatchObject({
      name: 'UnrecordedLaunchError',
      terminalHandle: 'term_8',
      message: 'the runtime returned no pane to watch'
    })
    expect(launchAgentTerminal.mock.calls[0][0]).toBe('path:/wt')
  })
})
