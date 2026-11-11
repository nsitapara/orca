import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { testDefinition, testStep } from '../../shared/definition/__fixtures__/definition'
import type { StepDef } from '../../shared/definition/types'
import { PilotStore } from '../store/store'
import { launchAgentStep, type AgentStepDeps } from './agent-step'
import { cliExec, type ExecResult } from './foreign-exec'
import type { ForeignLaunch, ForeignLaunchers } from './foreign-launch'
import { herdrLauncher, launcherScript } from './herdr-launch'
import type { Workspace } from './workspace'

const SESSION = '00000000-0000-4000-8000-00000000000a'
const workspace: Workspace = {
  kind: 'item_worktree',
  path: '/wt/a',
  worktreeId: 'r::/wt/a',
  selector: 'id:r::/wt/a',
  created: false
}

function setup(steps: StepDef[]) {
  const definition = testDefinition({ id: 'kick', name: 'Kickoff', repo: 'web', steps })
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
  const launches: ForeignLaunch[] = []
  const launcher = (ref: string) =>
    vi.fn(async (launch: ForeignLaunch) => {
      launches.push(launch)
      return { externalRef: ref, detail: { pane: 'w1:p2' } }
    })
  const foreignLaunchers: ForeignLaunchers = { herdr: launcher('w1:t2'), t3: launcher('thread-9') }
  const launchTerminal = vi.fn(async () => ({ handle: 'term_1', paneKey: 'tab1:leaf' }))
  const deps: AgentStepDeps = {
    launchTerminal,
    modeText: async () => null,
    newSessionId: () => SESSION,
    now: () => 7,
    transcriptExists: async () => true,
    foreignLaunchers
  }
  const request = (stepIdx: number) => ({
    runId: 'run-1',
    definition,
    stepIdx,
    itemKey: 'wt:a',
    label: 'web-1-a',
    fields: {},
    workspace
  })
  return { store, deps, launches, launchTerminal, foreignLaunchers, request }
}

const handOver = (system: 'herdr' | 't3', over: Partial<StepDef> = {}) =>
  testStep({ name: 'kickoff', prompt: 'Start {x}', wait: 'start', system, ...over })

describe('a step on another system', () => {
  it.each([
    ['herdr', 'w1:t2', ['--prompt-suggestions=false', '--session-id', SESSION, '--model', 'opus']],
    ['t3', 'thread-9', ['--prompt-suggestions=false', '--model', 'opus']]
  ] as const)(
    'on %s ends done, detached, with its ref, once launched',
    async (system, ref, argv) => {
      const { store, deps, launches, launchTerminal, request } = setup([
        handOver(system, { args: ['--model', 'opus'] })
      ])
      await expect(launchAgentStep(store, request(0), deps)).resolves.toEqual({
        system,
        externalRef: ref
      })
      expect(launchTerminal).not.toHaveBeenCalled()
      expect(launches[0]).toMatchObject({
        system,
        agent: 'claude',
        repo: 'web',
        cwd: '/wt/a',
        title: '[Automation] Kickoff · web-1-a · kickoff',
        argv,
        args: ['--model', 'opus']
      })
      expect(launches[0].env).toMatchObject({ PILOT_RUN_ID: 'run-1', PILOT_STEP: 'kickoff' })
      expect(launches[0].prompt).toContain('Start {x}')
      expect(store.runs.steps('run-1')[0]).toMatchObject({
        status: 'done',
        detached: true,
        finishedAt: 7,
        system,
        externalRef: ref,
        sessionId: null,
        terminalHandle: null,
        paneKey: null
      })
      const events = store.events.forRun('run-1')
      expect(events.map((e) => [e.kind, e.payload])).toContainEqual([
        'step_handed_over',
        expect.objectContaining({ step: 'kickoff', system, ref, pane: 'w1:p2' })
      ])
    }
  )

  it.each([
    [
      'a step Pilot would follow to its end',
      [testStep({ name: 'fix', prompt: 'x', system: 'herdr' })],
      0,
      "system herdr can't report a step's end to Pilot; only a wait: start step can run there"
    ],
    [
      'a step that would resume a session',
      [
        testStep({ name: 'review', prompt: 'x' }),
        handOver('t3', { session: { kind: 'continue', step: 'review' } })
      ],
      1,
      'system t3 runs only a new session (session: new)'
    ],
    [
      'a per_worktree step',
      [handOver('herdr', { session: { kind: 'per_worktree' } })],
      0,
      'system herdr runs only a new session (session: new)'
    ]
  ])('refuses %s before any agent starts', async (_, steps, idx, reason) => {
    const { store, deps, launchTerminal, foreignLaunchers, request } = setup(steps)
    if (idx > 0) {
      store.runs.createStep({
        runId: 'run-1',
        idx: 0,
        name: 'review',
        agent: 'claude',
        skill: null,
        startedAt: 1,
        sessionId: SESSION,
        status: 'done'
      })
    }
    await expect(launchAgentStep(store, request(idx), deps)).rejects.toThrow(reason)
    expect(launchTerminal).not.toHaveBeenCalled()
    expect(foreignLaunchers.herdr).not.toHaveBeenCalled()
    expect(foreignLaunchers.t3).not.toHaveBeenCalled()
    expect(store.runs.steps('run-1')[idx]).toMatchObject({ status: 'failed', error: reason })
  })

  it("fails the step with the launcher's error", async () => {
    const { store, deps, request } = setup([handOver('t3')])
    deps.foreignLaunchers!.t3 = async () => {
      throw new Error("t3 thread start failed: No T3 Code project matches '/wt/a'.")
    }
    await expect(launchAgentStep(store, request(0), deps)).rejects.toThrow('No T3 Code project')
    expect(store.runs.steps('run-1')[0]).toMatchObject({
      status: 'failed',
      error: "t3 thread start failed: No T3 Code project matches '/wt/a'."
    })
  })
})

type Call = { args: readonly string[]; input?: string }
function fakeCli(answer: (args: readonly string[]) => Partial<ExecResult>) {
  const calls: Call[] = []
  const exec = async (args: readonly string[], input?: string): Promise<ExecResult> => {
    calls.push({ args, input })
    return { code: 0, stdout: '', stderr: '', ...answer(args) }
  }
  return { exec, calls }
}

const LAUNCH: ForeignLaunch = {
  system: 'herdr',
  agent: 'claude',
  runId: 'run-1',
  stepIdx: 0,
  repo: 'web',
  cwd: '/wt/a',
  title: '[Automation] Kickoff · web-1-a · kickoff',
  prompt: "it's -raw",
  env: { PILOT_RUN_ID: 'run-1' },
  argv: ['--session-id', SESSION],
  args: []
}

describe('herdrLauncher', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-herdr-test-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const ok = (result: object) => ({ stdout: JSON.stringify({ result }) })
  function herdr(over: (args: readonly string[]) => Partial<ExecResult> | null = () => null) {
    let running = false
    const cli = fakeCli((args) => {
      const own = over(args)
      if (own) {
        return own
      }
      const key = args.slice(0, 2).join(' ')
      if (key === 'status server') {
        return { stdout: running ? 'status: running' : 'status: not running' }
      }
      if (key === 'workspace list') {
        return ok({ workspaces: [{ workspace_id: 'w0', label: 'other' }] })
      }
      if (key === 'workspace create') {
        return ok({ workspace: { workspace_id: 'w1' } })
      }
      if (key === 'tab create') {
        return ok({ tab: { tab_id: 'w1:t2' }, root_pane: { pane_id: 'w1:p2' } })
      }
      if (key === 'pane read') {
        return { stdout: '% ' }
      }
      return {}
    })
    const startServer = vi.fn(() => {
      running = true
    })
    let clock = 0
    const launch = herdrLauncher({
      herdr: cli.exec,
      startServer,
      launcherDir: dir,
      now: () => clock,
      pause: async (ms) => {
        clock += ms
      }
    })
    return { launch, calls: cli.calls, startServer, dir }
  }

  it("starts the server, makes the repo's workspace and a tab, then runs the launcher in its pane", async () => {
    const { launch, calls, startServer, dir } = herdr()
    await expect(launch(LAUNCH)).resolves.toEqual({
      externalRef: 'w1:t2',
      detail: { workspace: 'w1', tab: 'w1:t2', pane: 'w1:p2' }
    })
    expect(startServer).toHaveBeenCalledOnce()
    const made = calls.map((c) => c.args).filter((a) => a[0] !== 'status' && a[4] !== 'visible')
    expect(made).toEqual([
      ['workspace', 'list'],
      ['workspace', 'create', '--cwd', '/wt/a', '--label', 'web', '--no-focus'],
      [
        'tab',
        'create',
        '--workspace',
        'w1',
        '--cwd',
        '/wt/a',
        '--label',
        '[Automation] Kickoff · web-1-a · kickoff',
        '--no-focus'
      ],
      ['pane', 'read', 'w1:p2', '--source', 'recent-unwrapped', '--lines', '5'],
      ['pane', 'run', 'w1:p2', `sh '${dir}/run-1-0.sh'`]
    ])
  })

  it('closes the tab when the launcher cannot be run', async () => {
    const { launch, calls } = herdr((args) =>
      args[1] === 'run' ? { code: 1, stdout: '{"error":{"code":"pane_not_found"}}' } : null
    )
    await expect(launch(LAUNCH)).rejects.toThrow('pane_not_found')
    expect(calls.at(-1)?.args).toEqual(['tab', 'close', 'w1:t2'])
  })

  it('fails, and closes the tab, when Claude stops at its trust dialog instead of starting', async () => {
    const dialog =
      '│ Quick safety check: Is this a project you created or one you trust?\n│ ❯ 1. Yes, I trust this\n│   folder'
    let launched = false
    const { launch, calls } = herdr((args) => {
      if (args[1] === 'run') {
        launched = true
      }
      return args[4] === 'visible' && launched ? { stdout: dialog } : null
    })
    await expect(launch(LAUNCH)).rejects.toThrow(
      'Claude asks whether to trust /wt/a; open Claude there once and trust it'
    )
    expect(calls.at(-1)?.args).toEqual(['tab', 'close', 'w1:t2'])
  })

  it('writes a launcher that exports the step env and starts the agent on the prompt file', () => {
    expect(launcherScript(LAUNCH, '/d/run-1-0.prompt').split('\n').slice(3)).toEqual([
      "export PILOT_RUN_ID='run-1'",
      "cd '/wt/a' || exit 1",
      `exec 'claude' '--session-id' '${SESSION}' "$(cat '/d/run-1-0.prompt')"`,
      ''
    ])
  })
})

describe('cliExec', () => {
  it('rejects when the binary is missing', async () => {
    await expect(cliExec('/nonexistent/t3')(['thread', 'start'], 'prompt')).rejects.toThrow(
      'ENOENT'
    )
  })
})
