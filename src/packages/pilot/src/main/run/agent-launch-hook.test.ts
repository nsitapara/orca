import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: { fromId: vi.fn(() => null) },
  webContents: { fromId: vi.fn(() => null) },
  ipcMain: { on: vi.fn(), removeListener: vi.fn() },
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
}))

import { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import {
  spliceAgentArgv,
  withPilotAgentLaunch,
  type PilotAgentLaunchOptions
} from './agent-launch-hook'

const built = (command: string, env?: Record<string, string>) => ({
  agent: 'claude' as const,
  startup: { command, ...(env ? { env } : {}) }
})

describe('withPilotAgentLaunch', () => {
  it('returns every launch without Pilot extras exactly as upstream built it', () => {
    const startup = built("claude 'fix it'", { A: '1' })
    expect(withPilotAgentLaunch({ prompt: 'fix it' }, startup)).toBe(startup)
  })

  it("puts Pilot's env over the agent's and its argv before the prompt", () => {
    const opts = {
      prompt: 'fix it',
      pilot: { env: { PILOT_RUN_ID: 'r1', A: '2' }, argv: ['--session-id', 'u-1'] }
    }
    expect(
      withPilotAgentLaunch(opts, built("claude 'fix it'", { A: '1', B: '1' })).startup
    ).toEqual({
      command: "claude '--session-id' 'u-1' 'fix it'",
      env: { A: '2', B: '1', PILOT_RUN_ID: 'r1' }
    })
  })
})

describe('spliceAgentArgv', () => {
  it.each<[string, string, string, string[], string]>([
    ['no argv', "claude 'x'", 'x', [], "claude 'x'"],
    ['an empty prompt: argv goes last', 'codex', '', ['resume', 's-1'], "codex 'resume' 's-1'"],
    [
      'codex resume after the settings args',
      "codex --yolo 'do it'",
      'do it',
      ['resume', 's-1'],
      "codex --yolo 'resume' 's-1' 'do it'"
    ],
    [
      'a prompt the shell quotes in pieces',
      `claude 'it'"'"'s'`,
      "it's",
      ['--resume', 'a'],
      `claude '--resume' 'a' 'it'"'"'s'`
    ],
    [
      'a prompt with surrounding blank lines',
      "claude 'two\nlines'",
      '\ntwo\nlines\n',
      ['--session-id', 'u'],
      "claude '--session-id' 'u' 'two\nlines'"
    ]
  ])('%s', (_name, command, prompt, argv, expected) => {
    expect(spliceAgentArgv(command, prompt, argv, 'posix')).toBe(expected)
  })

  it("refuses a command that doesn't end with the prompt, so a step never starts without its session id", () => {
    expect(() =>
      spliceAgentArgv("claude --prefill 'x'", 'y', ['--session-id', 'u'], 'posix')
    ).toThrow("Pilot couldn't place its arguments before the agent's prompt")
  })
})

// The hook in place: a real OrcaRuntimeService, its protected launch members stubbed as upstream's
// own launch-agent-terminal-followup.test.ts does.
function runtimeWithStubs() {
  const repo = { id: 'repo-1', path: '/home/me/app' }
  const runtime = new OrcaRuntimeService()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the launch reads only these protected members; each is assigned or stubbed before launchAgentTerminal runs.
  const internals = runtime as unknown as {
    store: Record<string, unknown>
    resolveWorktreeSelector: (selector: string) => Promise<unknown>
    createTerminal: (selector: string, opts: unknown) => Promise<unknown>
    sendStartupFollowupWhenReady: (handle: string, followup: unknown) => void
  }
  internals.store = {
    getSettings: () => ({ disabledTuiAgents: [], workspaceDir: '/tmp/workspaces' }),
    getProjectHostSetups: () => [],
    getRepos: () => [repo],
    getRepo: (id: string) => (id === repo.id ? repo : undefined)
  }
  vi.spyOn(internals, 'resolveWorktreeSelector').mockResolvedValue({
    id: 'repo-1::/home/me/app-feature',
    repoId: 'repo-1',
    path: '/home/me/app-feature'
  })
  const createTerminal = vi.spyOn(internals, 'createTerminal').mockResolvedValue({
    handle: 'term_x',
    worktreeId: 'repo-1::/home/me/app-feature',
    title: null
  })
  vi.spyOn(internals, 'sendStartupFollowupWhenReady').mockImplementation(() => undefined)
  return { runtime, createTerminal }
}

type TerminalOpts = { command: string; env?: Record<string, string>; title?: string }

describe('launchAgentTerminal with the agent-launch-env hook', () => {
  it("gives the agent terminal Pilot's env and puts the pinned session before the prompt", async () => {
    const { runtime, createTerminal } = runtimeWithStubs()
    const opts: PilotAgentLaunchOptions = {
      agent: 'claude',
      prompt: 'fix the flaky test',
      title: 'Fix CI · !1561',
      pilot: { env: { PILOT_RUN_ID: 'r1', PILOT_STEP_IDX: '0' }, argv: ['--session-id', 'u-1'] }
    }
    await runtime.launchAgentTerminal('id:repo-1::/home/me/app-feature', opts)
    const [, terminal] = createTerminal.mock.calls[0] as [string, TerminalOpts]
    expect(terminal.env).toMatchObject({ PILOT_RUN_ID: 'r1', PILOT_STEP_IDX: '0' })
    expect(terminal.command).toMatch(/'--session-id' 'u-1' 'fix the flaky test'$/)
    expect(terminal.title).toBe('Fix CI · !1561')
  })

  it('leaves a launch that carries no Pilot extras as upstream builds it', async () => {
    const { runtime, createTerminal } = runtimeWithStubs()
    await runtime.launchAgentTerminal('id:repo-1::/home/me/app-feature', {
      agent: 'claude',
      prompt: 'fix the flaky test'
    })
    const [, terminal] = createTerminal.mock.calls[0] as [string, TerminalOpts]
    expect(terminal.command).toMatch(/'fix the flaky test'$/)
    expect(terminal.command).not.toContain('--session-id')
    expect(terminal.env?.PILOT_RUN_ID).toBeUndefined()
  })
})
