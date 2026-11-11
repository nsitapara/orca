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
import { t3CliClient, t3Launcher, type T3Project, type T3ThreadRequest } from './t3-launch'
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
    const made = calls.map((c) => c.args).filter((a) => a[0] !== 'status')
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

  it('writes a launcher that exports the step env and starts the agent on the prompt file', () => {
    expect(launcherScript(LAUNCH, '/d/run-1-0.prompt').split('\n').slice(3)).toEqual([
      "export PILOT_RUN_ID='run-1'",
      "cd '/wt/a' || exit 1",
      `exec 'claude' '--session-id' '${SESSION}' "$(cat '/d/run-1-0.prompt')"`,
      ''
    ])
  })
})

describe('t3Launcher', () => {
  function t3(projects: T3Project[] | null) {
    const started: T3ThreadRequest[] = []
    const launch = t3Launcher({
      client: {
        projects: async () => projects,
        startThread: async (req) => {
          started.push(req)
          return 'thread-9'
        }
      },
      checkoutOf: async () => '/repos/web'
    })
    return { launch, started }
  }
  const PROJECTS = [
    { id: 'p-other', workspaceRoot: '/repos' },
    { id: 'p-web', workspaceRoot: '/repos/web' }
  ]

  it.each([
    ['in a worktree', '/wt/a', [], '/wt/a', null],
    [
      'in the main checkout',
      '/repos/web',
      ['--model', 'gpt-6'],
      null,
      { provider: 'codex', model: 'gpt-6' }
    ],
    ['with --model=', '/wt/a', ['--model=gpt-6'], '/wt/a', { provider: 'codex', model: 'gpt-6' }]
  ])("starts a thread of the repo's project %s", async (_, cwd, args, worktreePath, model) => {
    const { launch, started } = t3(PROJECTS)
    await expect(launch({ ...LAUNCH, system: 't3', agent: 'codex', cwd, args })).resolves.toEqual({
      externalRef: 'thread-9',
      detail: { thread: 'thread-9', project: 'p-web' }
    })
    expect(started).toEqual([
      {
        project: 'p-web',
        worktreePath,
        title: '[Automation] Kickoff · web-1-a · kickoff',
        message: "it's -raw",
        model
      }
    ])
  })

  it("hands the checkout's path to T3 when the transport can't list projects", async () => {
    const { launch, started } = t3(null)
    await launch({ ...LAUNCH, system: 't3', cwd: '/repos/web' })
    expect(started[0].project).toBe('/repos/web')
  })

  it('fails when no T3 project is the repo', async () => {
    const { launch, started } = t3([PROJECTS[0]])
    await expect(launch({ ...LAUNCH, system: 't3' })).rejects.toThrow(
      'No T3 project has /repos/web (repo web) as its folder; add it in T3'
    )
    expect(started).toEqual([])
  })
})

describe('t3CliClient', () => {
  const REQ: T3ThreadRequest = {
    project: '/repos/web',
    worktreePath: null,
    title: 'T',
    message: "it's -raw",
    model: { provider: 'claudeAgent', model: 'opus' }
  }

  it('starts the thread with the prompt on stdin and reads its id', async () => {
    const cli = fakeCli(() => ({ stdout: '{"threadId":"thread-9","runId":"r"}\n' }))
    await expect(t3CliClient(cli.exec).startThread(REQ)).resolves.toBe('thread-9')
    expect(cli.calls).toEqual([
      {
        args: [
          'thread',
          'start',
          '/repos/web',
          '-',
          '--title',
          'T',
          '--provider',
          'claudeAgent',
          '--model',
          'opus',
          '--json'
        ],
        input: "it's -raw"
      }
    ])
  })

  it("refuses an existing worktree, which the CLI can't bind, before calling t3", async () => {
    const cli = fakeCli(() => ({}))
    await expect(
      t3CliClient(cli.exec).startThread({ ...REQ, worktreePath: '/wt/a' })
    ).rejects.toThrow("t3's CLI can't start a thread in an existing worktree (/wt/a)")
    expect(cli.calls).toEqual([])
  })

  it("fails with T3's own reason, and lists no projects on a CLI without project list", async () => {
    const cli = fakeCli(() => ({ code: 1, stderr: "No T3 Code project matches '/repos/web'.\n" }))
    await expect(t3CliClient(cli.exec).startThread(REQ)).rejects.toThrow(
      "t3 thread start failed: No T3 Code project matches '/repos/web'."
    )
    await expect(t3CliClient(cli.exec).projects()).resolves.toBeNull()
  })
})

describe('cliExec', () => {
  it('rejects when the binary is missing', async () => {
    await expect(cliExec('/nonexistent/t3')(['thread', 'start'], 'prompt')).rejects.toThrow(
      'ENOENT'
    )
  })
})
