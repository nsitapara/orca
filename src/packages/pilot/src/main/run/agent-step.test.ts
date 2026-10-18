import { describe, expect, it, vi } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { AutomationDefinition } from '../../shared/definition/types'
import { PilotStore } from '../store/store'
import type { PilotAgentLaunchOptions } from './agent-launch-hook'
import {
  launchAgentStep,
  type AgentStepDeps,
  type AgentStepRequest,
  type SessionTerminalState
} from './agent-step'
import { SessionClaims } from './session-claims'
import type { Workspace } from './workspace'

const workspace: Workspace = {
  kind: 'item_worktree',
  path: '/wt/a',
  worktreeId: 'r::/wt/a',
  selector: 'id:r::/wt/a',
  created: false
}

function setup(definition: AutomationDefinition, over: Partial<AgentStepDeps> = {}) {
  const store = PilotStore.open(':memory:')
  store.runs.create({
    id: 'run-1',
    automationId: definition.id,
    tickId: null,
    itemKey: 'wt:a',
    itemLabel: 'web-1-a',
    worktreePath: '/wt/a',
    startedAt: 1
  })
  let n = 0
  const launchTerminal = vi.fn(async (_selector: string, _opts: PilotAgentLaunchOptions) => {
    n += 1
    return { handle: `term_${n}`, paneKey: `tab${n}:leaf` }
  })
  const deps: AgentStepDeps = {
    launchTerminal,
    modeText: async () => null,
    newSessionId: () => '00000000-0000-4000-8000-00000000000a',
    now: () => 7,
    transcriptExists: async () => true,
    ...over
  }
  const request = (stepIdx: number, runId = 'run-1'): AgentStepRequest => ({
    runId,
    definition,
    stepIdx,
    itemKey: 'wt:a',
    label: 'web-1-a',
    fields: { 'worktree.branch': 'web-1-a' },
    workspace
  })
  return { store, deps, launchTerminal, request }
}
const argvOf = (call: [string, PilotAgentLaunchOptions]) => call[1].pilot.argv
// What the run engine records when a step's agent finishes; only then does the next step resume it.
const finish = (store: PilotStore, runId: string, idx: number) =>
  store.runs.updateStep(runId, idx, { status: 'done', finishedAt: 7 })

describe('launchAgentStep', () => {
  it("resumes an earlier step's session for session: continue", async () => {
    const def = testDefinition({
      id: 'review',
      steps: [
        testStep({ name: 'review' }),
        testStep({
          name: 'fix',
          session: { kind: 'continue', step: 'review' },
          args: ['--dangerously-skip-permissions']
        })
      ]
    })
    const { store, request, launchTerminal, deps } = setup(def)
    await launchAgentStep(store, request(0), deps)
    finish(store, 'run-1', 0)
    await launchAgentStep(store, request(1), deps)
    expect(argvOf(launchTerminal.mock.calls[0])).toEqual([
      '--prompt-suggestions=false',
      '--session-id',
      '00000000-0000-4000-8000-00000000000a'
    ])
    expect(argvOf(launchTerminal.mock.calls[1])).toEqual([
      '--prompt-suggestions=false',
      '--resume',
      '00000000-0000-4000-8000-00000000000a',
      '--dangerously-skip-permissions'
    ])
    expect(store.runs.steps('run-1').map((s) => [s.name, s.status, s.sessionId])).toEqual([
      ['review', 'done', '00000000-0000-4000-8000-00000000000a'],
      ['fix', 'running', '00000000-0000-4000-8000-00000000000a']
    ])
  })

  it('resumes the session of a continued run with a prompt to carry on, not the step from the start', async () => {
    const def = testDefinition({
      steps: [testStep({ name: 'review', prompt: 'Review it', args: ['--model', 'opus'] })]
    })
    const { store, request, launchTerminal, deps } = setup(def)
    const sessionId = '00000000-0000-4000-8000-0000000000f1'
    const reason = 'The terminal closed before the agent finished'
    await launchAgentStep(store, { ...request(0), resume: { sessionId, reason } }, deps)
    expect(argvOf(launchTerminal.mock.calls[0])).toEqual([
      '--prompt-suggestions=false',
      '--resume',
      sessionId,
      '--model',
      'opus'
    ])
    const prompt = launchTerminal.mock.calls[0][1].prompt
    expect(prompt).toContain(reason)
    expect(prompt).not.toContain('Review it')
    expect(store.runs.steps('run-1').map((s) => [s.name, s.status, s.sessionId])).toEqual([
      ['review', 'running', sessionId]
    ])
  })

  it("fails the step without launching when the session to continue isn't there", async () => {
    const def = testDefinition({
      steps: [
        testStep({ name: 'review' }),
        testStep({ name: 'fix', session: { kind: 'continue', step: 'review' } })
      ]
    })
    const { store, request, launchTerminal, deps } = setup(def)
    await expect(launchAgentStep(store, request(1), deps)).rejects.toThrow(
      'Step "review" hasn\'t run'
    )
    expect(launchTerminal).not.toHaveBeenCalled()
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      name: 'fix',
      status: 'failed',
      error: expect.stringContaining("hasn't run")
    })
  })

  it('pins and remembers a per-worktree Claude session, then resumes it on the next run', async () => {
    const def = testDefinition({
      id: 'cycles',
      steps: [testStep({ name: 'pass', session: { kind: 'per_worktree' } })]
    })
    const { store, request, launchTerminal, deps } = setup(def)
    await launchAgentStep(store, request(0), deps)
    expect(store.sessions.get('cycles', '/wt/a', 'claude')?.sessionId).toBe(
      '00000000-0000-4000-8000-00000000000a'
    )
    finish(store, 'run-1', 0)
    store.runs.create({
      id: 'run-2',
      automationId: 'cycles',
      tickId: null,
      itemKey: 'wt:a',
      itemLabel: 'web-1-a',
      worktreePath: '/wt/a',
      startedAt: 2
    })
    await launchAgentStep(store, request(0, 'run-2'), {
      ...deps,
      newSessionId: () => '00000000-0000-4000-8000-00000000000b'
    })
    expect(argvOf(launchTerminal.mock.calls[1])).toEqual([
      '--prompt-suggestions=false',
      '--resume',
      '00000000-0000-4000-8000-00000000000a'
    ])
  })

  // A stored session whose transcript is gone (Claude deletes them after 30 days; a pinned one that never
  // started has none) would make `--resume` exit to a shell, and the step read working until its timeout.
  it.each<['claude' | 'codex', boolean, string[], string | null]>([
    [
      'claude',
      false,
      ['--prompt-suggestions=false', '--session-id', '00000000-0000-4000-8000-00000000000a'],
      '00000000-0000-4000-8000-00000000000a'
    ],
    [
      'claude',
      true,
      ['--prompt-suggestions=false', '--resume', '00000000-0000-4000-8000-00000000000c'],
      '00000000-0000-4000-8000-00000000000c'
    ],
    ['codex', false, [], null],
    [
      'codex',
      true,
      ['resume', '00000000-0000-4000-8000-00000000000c'],
      '00000000-0000-4000-8000-00000000000c'
    ]
  ])(
    'per_worktree %s with its transcript on disk %s: resumes it only when it is there',
    async (agent, onDisk, argv, kept) => {
      const def = testDefinition({
        id: 'cycles',
        steps: [testStep({ name: 'pass', agent, session: { kind: 'per_worktree' } })]
      })
      const transcriptExists = vi.fn(async () => onDisk)
      const { store, request, launchTerminal, deps } = setup(def, { transcriptExists })
      // The session's first step, long ago: where Codex filed its rollout, and the path its hooks gave.
      store.runs.create({
        id: 'run-0',
        automationId: 'cycles',
        tickId: null,
        itemKey: 'wt:a',
        itemLabel: 'web-1-a',
        worktreePath: '/wt/a',
        startedAt: 2
      })
      store.runs.createStep({
        runId: 'run-0',
        idx: 0,
        name: 'pass',
        agent,
        skill: null,
        startedAt: 2
      })
      store.runs.updateStep('run-0', 0, {
        status: 'done',
        sessionId: '00000000-0000-4000-8000-00000000000c',
        transcriptPath: '/t/00000000-0000-4000-8000-00000000000c.jsonl'
      })
      store.sessions.set('cycles', '/wt/a', agent, '00000000-0000-4000-8000-00000000000c', 5)
      await launchAgentStep(store, request(0), deps)
      expect(transcriptExists).toHaveBeenCalledWith(
        agent,
        '00000000-0000-4000-8000-00000000000c',
        '/t/00000000-0000-4000-8000-00000000000c.jsonl',
        2
      )
      expect(argvOf(launchTerminal.mock.calls[0])).toEqual(argv)
      expect(store.sessions.get('cycles', '/wt/a', agent)?.sessionId ?? null).toBe(kept)
    }
  )

  it("doesn't pin or store a Codex session (it is learned from its hooks)", async () => {
    const def = testDefinition({
      id: 'cycles',
      steps: [testStep({ name: 'pass', agent: 'codex', session: { kind: 'per_worktree' } })]
    })
    const { store, request, launchTerminal, deps } = setup(def)
    await launchAgentStep(store, request(0), deps)
    expect(argvOf(launchTerminal.mock.calls[0])).toEqual([])
    expect(store.sessions.get('cycles', '/wt/a', 'codex')).toBeNull()
    expect(store.runs.steps('run-1')[0].sessionId).toBeNull()
  })

  it('launches with the step env, the mode text in a wrapped prompt, and a title naming the step', async () => {
    const def = testDefinition({
      id: 'ci',
      name: 'Fix CI',
      powers: ['commit'],
      steps: [
        testStep({
          name: 'fix',
          skill: 'fix-gitlab-ci',
          mode: 'answers',
          prompt: 'Go on {worktree.branch}.'
        }),
        testStep({ name: 'cleanup' })
      ]
    })
    const modeText = vi.fn(async () => 'Answer mode.')
    const { store, request, launchTerminal, deps } = setup(def, { modeText })
    await launchAgentStep(store, request(0), deps)
    expect(modeText).toHaveBeenCalledWith(expect.objectContaining({ name: 'fix' }), '/wt/a')
    const [selector, opts] = launchTerminal.mock.calls[0]
    expect(selector).toBe('id:r::/wt/a')
    expect(opts).toMatchObject({
      agent: 'claude',
      title: 'Fix CI · web-1-a · fix',
      prompt:
        'Started by the Pilot automation "Fix CI" (run run-1) for web-1-a.\nUse the fix-gitlab-ci skill.\n\nAnswer mode.\n\nGo on web-1-a.',
      pilot: {
        env: expect.objectContaining({
          PILOT_STEP: 'fix',
          PILOT_STEP_IDX: '0',
          PILOT_POWERS: 'commit'
        })
      }
    })
  })

  it('fails the step with the reason when its mode text cannot be read', async () => {
    const def = testDefinition({ steps: [testStep({ mode: 'answers', skill: 'x' })] })
    const { store, request, launchTerminal, deps } = setup(def, {
      modeText: async () => {
        throw new Error('No mode "answers" in skill x')
      }
    })
    await expect(launchAgentStep(store, request(0), deps)).rejects.toThrow(
      'No mode "answers" in skill x'
    )
    expect(launchTerminal).not.toHaveBeenCalled()
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'failed',
      error: 'No mode "answers" in skill x'
    })
  })

  // B8: Task 9b's startRun writes step 0 as pending before the workspace exists.
  it('takes over the pending row the engine wrote instead of adding a second one', async () => {
    const def = testDefinition({ steps: [testStep({ name: 'fix' })] })
    const { store, request, deps } = setup(def)
    store.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 'fix',
      agent: 'claude',
      skill: null,
      status: 'pending',
      startedAt: null
    })
    await launchAgentStep(store, request(0), deps)
    expect(store.runs.steps('run-1')).toHaveLength(1)
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'running',
      sessionId: '00000000-0000-4000-8000-00000000000a',
      sessionPinned: true,
      startedAt: 7
    })
  })
})

// H10, one process per session: the session's old terminal takes the prompt only when it is free and
// its agent was started with this step's args; an idle Pilot tab that can't is closed first, and a busy
// one fails the step.
function terminalsIn(state: SessionTerminalState | Error) {
  return {
    state: vi.fn(async (_terminal: { handle: string; paneKey: string | null }, _id: string) => {
      if (state instanceof Error) {
        throw state
      }
      return state
    }),
    send: vi.fn(async (_handle: string, _prompt: string) => {}),
    close: vi.fn(async (_handle: string) => {})
  }
}
type Terminals = ReturnType<typeof terminalsIn>

describe('launchAgentStep for a session whose terminal may still be open', () => {
  const continuing = (fixArgs: string[] = []) =>
    testDefinition({
      id: 'review',
      steps: [
        testStep({ name: 'review' }),
        testStep({ name: 'fix', session: { kind: 'continue', step: 'review' }, args: fixArgs })
      ]
    })
  async function reviewed(terminals: Terminals, fixArgs: string[] = []) {
    const s = setup(continuing(fixArgs), { sessionTerminals: terminals })
    await launchAgentStep(s.store, s.request(0), s.deps)
    finish(s.store, 'run-1', 0)
    return s
  }
  const BUSY = 'Session 00000000-0000-4000-8000-00000000000a is busy in Auto · web-1-a · review'

  it.each<[string, SessionTerminalState, string[], boolean, boolean, string[] | null]>([
    ['free, started with the same args: the prompt goes in', 'free', [], true, false, null],
    [
      "free, started with other args: closed, then resumed with this step's",
      'free',
      ['--x'],
      false,
      true,
      ['--prompt-suggestions=false', '--resume', '00000000-0000-4000-8000-00000000000a', '--x']
    ],
    [
      'running another session: closed, then resumed',
      'other',
      [],
      false,
      true,
      ['--prompt-suggestions=false', '--resume', '00000000-0000-4000-8000-00000000000a']
    ],
    [
      'gone: resumed in a new terminal',
      'gone',
      [],
      false,
      false,
      ['--prompt-suggestions=false', '--resume', '00000000-0000-4000-8000-00000000000a']
    ]
  ])('%s', async (_name, state, fixArgs, sent, closed, argv) => {
    const terminals = terminalsIn(state)
    const { store, request, launchTerminal, deps } = await reviewed(terminals, fixArgs)
    await launchAgentStep(store, request(1), deps)
    expect(terminals.state).toHaveBeenCalledWith(
      { handle: 'term_1', paneKey: 'tab1:leaf' },
      '00000000-0000-4000-8000-00000000000a'
    )
    const prompt = expect.stringContaining('Started by the Pilot automation')
    expect(terminals.send.mock.calls).toEqual(sent ? [['term_1', prompt]] : [])
    expect(terminals.close.mock.calls).toEqual(closed ? [['term_1']] : [])
    expect(launchTerminal.mock.calls.slice(1).map(argvOf)).toEqual(argv ? [argv] : [])
    expect(store.runs.steps('run-1')[1]).toMatchObject({
      status: 'running',
      terminalHandle: sent ? 'term_1' : 'term_2',
      sessionId: '00000000-0000-4000-8000-00000000000a',
      launchArgs: fixArgs
    })
  })

  // S2: a sent step runs under the args its process was launched with, as stored then; definitions
  // reload live, so a YAML edit since closes the idle tab and resumes the session with the new args.
  it.each<[string, string[], string[], boolean]>([
    ['unchanged args: the prompt goes in', ['--x'], ['--x'], true],
    [
      'a flag removed from the YAML since: closed, then resumed without it',
      ['--dangerously-skip-permissions'],
      [],
      false
    ],
    ['a flag added since: closed, then resumed with it', [], ['--x'], false]
  ])('per_worktree, %s', async (_name, firstArgs, nextArgs, sent) => {
    const cycles = (args: string[]) =>
      testDefinition({
        id: 'cycles',
        steps: [testStep({ name: 'pass', session: { kind: 'per_worktree' }, args })]
      })
    const terminals = terminalsIn('free')
    const { store, request, launchTerminal, deps } = setup(cycles(firstArgs), {
      sessionTerminals: terminals
    })
    await launchAgentStep(store, request(0), deps)
    finish(store, 'run-1', 0)
    store.runs.create({
      id: 'run-2',
      automationId: 'cycles',
      tickId: null,
      itemKey: 'wt:a',
      itemLabel: 'web-1-a',
      worktreePath: '/wt/a',
      startedAt: 2
    })
    await launchAgentStep(store, { ...request(0, 'run-2'), definition: cycles(nextArgs) }, deps)
    expect(terminals.send.mock.calls.map(([handle]) => handle)).toEqual(sent ? ['term_1'] : [])
    expect(terminals.close.mock.calls).toEqual(sent ? [] : [['term_1']])
    const resumed = launchTerminal.mock.calls.slice(1).map(argvOf)
    expect(resumed).toEqual(
      sent
        ? []
        : [
            [
              '--prompt-suggestions=false',
              '--resume',
              '00000000-0000-4000-8000-00000000000a',
              ...nextArgs
            ]
          ]
    )
    expect(store.runs.steps('run-2')[0]).toMatchObject({
      terminalHandle: sent ? 'term_1' : 'term_2',
      launchArgs: nextArgs
    })
  })

  const flagged = () =>
    testDefinition({
      id: 'review',
      steps: [
        testStep({ name: 'review', args: ['--dangerously-skip-permissions'] }),
        testStep({
          name: 'fix',
          session: { kind: 'continue', step: 'review' },
          args: ['--dangerously-skip-permissions']
        })
      ]
    })

  it.each<[string, (store: PilotStore) => void, AutomationDefinition]>([
    [
      'its definition reloaded mid-run without the flag',
      () => {},
      testDefinition({
        id: 'review',
        steps: [
          testStep({ name: 'review' }),
          testStep({ name: 'fix', session: { kind: 'continue', step: 'review' } })
        ]
      })
    ],
    [
      'its launch args unknown (an older row)',
      (store) => store.runs.updateStep('run-1', 0, { launchArgs: null }),
      flagged()
    ]
  ])('continue into a process with %s: closed, then resumed', async (_name, arrange, now) => {
    const terminals = terminalsIn('free')
    const { store, request, launchTerminal, deps } = setup(flagged(), {
      sessionTerminals: terminals
    })
    await launchAgentStep(store, request(0), deps)
    finish(store, 'run-1', 0)
    arrange(store)
    await launchAgentStep(store, { ...request(1), definition: now }, deps)
    expect(terminals.send).not.toHaveBeenCalled()
    expect(terminals.close).toHaveBeenCalledWith('term_1')
    expect(launchTerminal).toHaveBeenCalledTimes(2)
  })

  it.each<[string, SessionTerminalState | Error]>([
    ['busy', 'busy'],
    ['unreadable', new Error('runtime_unavailable')]
  ])(
    "fails the step, opening no terminal, when the session's terminal is %s",
    async (_name, state) => {
      const terminals = terminalsIn(state)
      const { store, request, launchTerminal, deps } = await reviewed(terminals)
      await expect(launchAgentStep(store, request(1), deps)).rejects.toThrow(BUSY)
      expect(launchTerminal).toHaveBeenCalledTimes(1)
      expect(terminals.send).not.toHaveBeenCalled()
      expect(terminals.close).not.toHaveBeenCalled()
      expect(store.runs.steps('run-1')[1]).toMatchObject({ status: 'failed', error: BUSY })
    }
  )

  it('fails the step without looking at the terminal while a Pilot step still runs in it', async () => {
    const terminals = terminalsIn('free')
    const { store, request, launchTerminal, deps } = setup(continuing(), {
      sessionTerminals: terminals
    })
    await launchAgentStep(store, request(0), deps)
    await expect(launchAgentStep(store, request(1), deps)).rejects.toThrow(BUSY)
    expect(terminals.state).not.toHaveBeenCalled()
    expect(launchTerminal).toHaveBeenCalledTimes(1)
  })

  it.each<[string, string[], 'send' | 'close']>([
    ['the prompt cannot be typed into a free terminal', [], 'send'],
    ['the idle terminal running the session cannot be closed', ['--x'], 'close']
  ])('fails the step, opening no second terminal, when %s', async (_name, fixArgs, failing) => {
    const terminals = terminalsIn('free')
    const refused = new Error('terminal term_1 has no idle agent to take the prompt')
    if (failing === 'send') {
      terminals.send.mockRejectedValue(refused)
    } else {
      terminals.close.mockRejectedValue(refused)
    }
    const { store, request, launchTerminal, deps } = await reviewed(terminals, fixArgs)
    await expect(launchAgentStep(store, request(1), deps)).rejects.toThrow(refused.message)
    expect(launchTerminal).toHaveBeenCalledTimes(1)
    expect(store.runs.steps('run-1')[1]).toMatchObject({ status: 'failed', error: refused.message })
  })

  it("looks at the newest terminal the session ran in, not only the continued step's", async () => {
    const def = testDefinition({
      id: 'review',
      steps: [
        testStep({ name: 'review' }),
        testStep({ name: 'fix', session: { kind: 'continue', step: 'review' } }),
        testStep({ name: 'verify', session: { kind: 'continue', step: 'review' } })
      ]
    })
    const terminals = terminalsIn('gone')
    const { store, request, deps } = setup(def, { sessionTerminals: terminals })
    for (const idx of [0, 1, 2]) {
      await launchAgentStep(store, request(idx), deps)
      finish(store, 'run-1', idx)
    }
    expect(terminals.state.mock.calls.map(([t]) => t.handle)).toEqual(['term_1', 'term_2'])
  })

  it("sends a per-worktree step into the stored session's free terminal", async () => {
    const def = testDefinition({
      id: 'cycles',
      steps: [testStep({ name: 'pass', session: { kind: 'per_worktree' } })]
    })
    const terminals = terminalsIn('free')
    const { store, request, launchTerminal, deps } = setup(def, { sessionTerminals: terminals })
    await launchAgentStep(store, request(0), deps)
    finish(store, 'run-1', 0)
    store.runs.create({
      id: 'run-2',
      automationId: 'cycles',
      tickId: null,
      itemKey: 'wt:a',
      itemLabel: 'web-1-a',
      worktreePath: '/wt/a',
      startedAt: 2
    })
    await launchAgentStep(store, request(0, 'run-2'), deps)
    expect(launchTerminal).toHaveBeenCalledTimes(1)
    expect(terminals.send).toHaveBeenCalledWith('term_1', expect.any(String))
    expect(store.runs.steps('run-2')[0]).toMatchObject({
      status: 'running',
      terminalHandle: 'term_1',
      sessionId: '00000000-0000-4000-8000-00000000000a'
    })
  })
})

// One process per session across ALL terminals: a tab no step row names (opened by Resume, by hand, or
// by another run) is found through Orca's agent rows before a new process is started.
describe('launchAgentStep for a session held in a tab no step row names', () => {
  const continuing = testDefinition({
    id: 'review',
    steps: [
      testStep({ name: 'review' }),
      testStep({ name: 'fix', session: { kind: 'continue', step: 'review' } })
    ]
  })
  function withForeignTab(states: Record<string, SessionTerminalState>) {
    const terminals = {
      state: vi.fn(async (t: { handle: string }, _id: string) => states[t.handle] ?? 'gone'),
      tabs: vi.fn(async (_id: string) => [{ handle: 'resume_tab', paneKey: 'rt:leaf' }]),
      send: vi.fn(async (_h: string, _p: string) => {}),
      close: vi.fn(async (_h: string) => {})
    }
    return { terminals, s: setup(continuing, { sessionTerminals: terminals }) }
  }

  it('fails the step instead of starting a second process when that tab is busy', async () => {
    const { terminals, s } = withForeignTab({ term_1: 'gone', resume_tab: 'busy' })
    await launchAgentStep(s.store, s.request(0), s.deps)
    finish(s.store, 'run-1', 0)
    await expect(launchAgentStep(s.store, s.request(1), s.deps)).rejects.toThrow(
      'Session 00000000-0000-4000-8000-00000000000a is busy in terminal resume_tab'
    )
    expect(s.launchTerminal).toHaveBeenCalledTimes(1)
    expect(terminals.close).not.toHaveBeenCalled()
  })

  it("closes an idle one (its args aren't known) before resuming, and with no such tab resumes as before", async () => {
    const idle = withForeignTab({ term_1: 'gone', resume_tab: 'free' })
    await launchAgentStep(idle.s.store, idle.s.request(0), idle.s.deps)
    finish(idle.s.store, 'run-1', 0)
    await launchAgentStep(idle.s.store, idle.s.request(1), idle.s.deps)
    expect(idle.terminals.close).toHaveBeenCalledWith('resume_tab')
    expect(idle.s.launchTerminal).toHaveBeenCalledTimes(2)
    const none = withForeignTab({ term_1: 'gone' })
    await launchAgentStep(none.s.store, none.s.request(0), none.s.deps)
    finish(none.s.store, 'run-1', 0)
    await launchAgentStep(none.s.store, none.s.request(1), none.s.deps)
    expect(none.terminals.close).not.toHaveBeenCalled()
  })
})

describe('launchAgentStep, one process per session: the row-named tab runs another session, and the claim', () => {
  const continuing = testDefinition({
    id: 'review',
    steps: [
      testStep({ name: 'review' }),
      testStep({ name: 'fix', session: { kind: 'continue', step: 'review' } })
    ]
  })
  function held(states: Record<string, SessionTerminalState>, draft = '') {
    const claims = new SessionClaims()
    const terminals = {
      state: vi.fn(async (t: { handle: string }, _id: string) => states[t.handle] ?? 'gone'),
      tabs: vi.fn(async (_id: string) => [{ handle: 'resume_tab', paneKey: 'rt:leaf' }]),
      draft: vi.fn(async (_h: string) => draft),
      send: vi.fn(async (_h: string, _p: string) => {}),
      close: vi.fn(async (_h: string) => {}),
      claims
    }
    return { terminals, claims, s: setup(continuing, { sessionTerminals: terminals }) }
  }
  async function reviewedIn(h: ReturnType<typeof held>) {
    await launchAgentStep(h.s.store, h.s.request(0), h.s.deps)
    finish(h.s.store, 'run-1', 0)
    h.claims.release('00000000-0000-4000-8000-00000000000a', 'launch:run-1:0')
  }

  it('finds the session in another tab when the step row tab was /cleared (other), and fails if it is busy', async () => {
    const h = held({ term_1: 'other', resume_tab: 'busy' })
    await reviewedIn(h)
    await expect(launchAgentStep(h.s.store, h.s.request(1), h.s.deps)).rejects.toThrow(
      'Session 00000000-0000-4000-8000-00000000000a is busy in terminal resume_tab'
    )
    expect(h.s.launchTerminal).toHaveBeenCalledTimes(1)
    expect(h.terminals.close).not.toHaveBeenCalled()
  })

  it('closes an idle foreign tab and the /cleared one, then resumes once', async () => {
    const h = held({ term_1: 'other', resume_tab: 'free' })
    await reviewedIn(h)
    await launchAgentStep(h.s.store, h.s.request(1), h.s.deps)
    expect(h.terminals.close.mock.calls).toEqual([['resume_tab'], ['term_1']])
    expect(h.s.launchTerminal).toHaveBeenCalledTimes(2)
  })

  it('treats an idle foreign tab as busy when a draft has appeared by the time it would be closed', async () => {
    const h = held({ term_1: 'gone', resume_tab: 'free' }, 'half a thought')
    await reviewedIn(h)
    await expect(launchAgentStep(h.s.store, h.s.request(1), h.s.deps)).rejects.toThrow(
      'Session 00000000-0000-4000-8000-00000000000a is busy in terminal resume_tab'
    )
    expect(h.terminals.close).not.toHaveBeenCalled()
  })

  it("fails the step, starting nothing, while another caller's claim holds the session", async () => {
    const h = held({ term_1: 'gone' })
    await reviewedIn(h)
    h.claims.acquire('00000000-0000-4000-8000-00000000000a', 'resume')
    await expect(launchAgentStep(h.s.store, h.s.request(1), h.s.deps)).rejects.toThrow(
      'Session 00000000-0000-4000-8000-00000000000a is busy: another caller is opening it'
    )
    expect(h.s.launchTerminal).toHaveBeenCalledTimes(1)
    expect(h.terminals.tabs).not.toHaveBeenCalled()
  })

  it('keeps its claim after starting a new process (the first row has not arrived), releases it after a send, and on failure', async () => {
    const started = held({ term_1: 'gone' })
    await reviewedIn(started)
    await launchAgentStep(started.s.store, started.s.request(1), started.s.deps)
    expect(started.claims.holder('00000000-0000-4000-8000-00000000000a')).toMatchObject({
      by: 'launch:run-1:1'
    })

    const sent = held({ term_1: 'free' })
    await reviewedIn(sent)
    sent.s.store.runs.updateStep('run-1', 0, { launchArgs: [] })
    await launchAgentStep(sent.s.store, sent.s.request(1), sent.s.deps)
    expect(sent.terminals.send).toHaveBeenCalled()
    expect(sent.claims.holder('00000000-0000-4000-8000-00000000000a')).toBeNull()

    const failed = held({ term_1: 'gone' })
    await reviewedIn(failed)
    failed.s.launchTerminal.mockRejectedValueOnce(new Error('boom'))
    await expect(
      launchAgentStep(failed.s.store, failed.s.request(1), failed.s.deps)
    ).rejects.toThrow('boom')
    expect(failed.claims.holder('00000000-0000-4000-8000-00000000000a')).toBeNull()
  })

  it.each([
    ['createTerminal gave no reply', 'Terminal creation timed out'],
    ['the handle never appeared', 'Timed out waiting for terminal handle after creation']
  ])(
    'keeps its claim when the launch times out (%s): the tab may still appear',
    async (_n, message) => {
      const h = held({ term_1: 'gone' })
      await reviewedIn(h)
      h.s.launchTerminal.mockRejectedValueOnce(new Error(message))
      await expect(launchAgentStep(h.s.store, h.s.request(1), h.s.deps)).rejects.toThrow(message)
      expect(h.claims.holder('00000000-0000-4000-8000-00000000000a')).toMatchObject({
        by: 'launch:run-1:1'
      })
    }
  )

  it('re-reads the draft of the row tab running another session right before closing it', async () => {
    const h = held({ term_1: 'other', resume_tab: 'gone' }, 'half a thought')
    await reviewedIn(h)
    await expect(launchAgentStep(h.s.store, h.s.request(1), h.s.deps)).rejects.toThrow(
      'Session 00000000-0000-4000-8000-00000000000a is busy in terminal term_1'
    )
    expect(h.terminals.close).not.toHaveBeenCalled()
  })

  it("says so when the claim's start is closed, instead of that another caller is opening it", async () => {
    const h = held({ term_1: 'gone' })
    await reviewedIn(h)
    h.claims.acquire('00000000-0000-4000-8000-00000000000a', 'resume:1')
    h.claims.setHandle('00000000-0000-4000-8000-00000000000a', 'resume:1', 'T_dead')
    ;(h.terminals as Record<string, unknown>).isOpen = vi.fn(async () => false)
    await expect(launchAgentStep(h.s.store, h.s.request(1), h.s.deps)).rejects.toThrow(
      "A previous start of session 00000000-0000-4000-8000-00000000000a didn't come up; try again"
    )
  })
})
