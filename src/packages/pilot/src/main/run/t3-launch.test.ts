import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import type { ExecResult } from './foreign-exec'
import type { ForeignLaunch } from './foreign-launch'
import { T3_SENTINEL, type T3Launch } from './t3-cli'
import { t3CliClient, t3Launcher, type T3Run } from './t3-launch'

const HOOK = fileURLToPath(new URL('../../../resources/t3_hook.mjs.txt', import.meta.url))
const APP = '/Applications/T3 Code (Beta).app/Contents/MacOS/T3 Code (Beta)'
const CLI = '/Applications/T3 Code (Beta).app/Contents/Resources/app.asar/apps/server/dist/bin.mjs'
// T3 Code v0.1.8's ~/.t3/bin/t3, as T3 writes it.
const LAUNCHER = `#!/bin/sh
# Written by T3 Code: runs the desktop app's bundled t3 CLI.
export T3CODE_CLI_PATH='/h/.t3/bin/t3'
home='/h/.t3'
export T3CODE_HOME="\${T3CODE_HOME:-$home}"
export ELECTRON_RUN_AS_NODE=1
app='${APP}'
if [ ! -x "$app" ]; then
  exit 127
fi
exec "$app" '${CLI}' "$@"
`

const LAUNCH: ForeignLaunch = {
  system: 't3',
  agent: 'claude',
  runId: 'run-1',
  stepIdx: 0,
  repo: 'web',
  cwd: '/wt/web/x',
  title: '[Automation] Kickoff · web-1-a · kickoff',
  prompt: "it's -raw",
  env: {},
  argv: [],
  args: []
}

describe('t3Launcher', () => {
  function t3() {
    const plans: T3Launch[] = []
    const launch = t3Launcher({
      client: {
        startThread: async (plan, message) => {
          expect(message).toBe("it's -raw")
          plans.push(plan)
          return { threadId: 'thread-9', projectId: 'p-web', runId: null }
        }
      },
      checkoutOf: async () => '/repos/web',
      branchOf: async () => 'feat/x'
    })
    return { launch, plans }
  }

  it.each([
    ['a worktree', '/wt/web/x', [], 'claude', '/wt/web/x', 'feat/x', null],
    [
      'the main checkout',
      '/repos/web',
      ['--model', 'gpt-6'],
      'codex',
      null,
      null,
      { provider: 'codex', model: 'gpt-6' }
    ],
    [
      'a worktree, --model=',
      '/wt/web/x',
      ['--model=opus'],
      'claude',
      '/wt/web/x',
      'feat/x',
      { provider: 'claudeAgent', model: 'opus' }
    ]
  ] as const)(
    "starts a thread of the repo's project in %s and records where it is",
    async (_, cwd, args, agent, worktree, branch, model) => {
      const { launch, plans } = t3()
      await expect(launch({ ...LAUNCH, agent, cwd, args })).resolves.toEqual({
        externalRef: 'thread-9',
        detail: {
          thread: 'thread-9',
          projectId: 'p-web',
          projectRoot: '/repos/web',
          worktreePath: cwd
        }
      })
      expect(plans).toEqual([
        { repo: 'web', projectRoot: '/repos/web', worktree, branch, title: LAUNCH.title, model }
      ])
    }
  )

  it('refuses a codex step that names no model, before T3 is asked', async () => {
    const { launch, plans } = t3()
    await expect(launch({ ...LAUNCH, agent: 'codex' })).rejects.toThrow(
      "system t3 runs its project's default model unless the step names one; a codex step there needs --model in args"
    )
    expect(plans).toEqual([])
  })
})

describe('t3CliClient', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-t3-test-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const launcherPath = join(dir, 't3')
  writeFileSync(launcherPath, LAUNCHER)
  const PLAN: T3Launch = {
    repo: 'web',
    projectRoot: '/r/web',
    worktree: '/w/web/x',
    branch: 'feat/x',
    title: 'Job · item',
    model: { provider: 'claudeAgent', model: 'opus' }
  }
  type Seen = {
    bin: string
    args: readonly string[]
    env: Record<string, string>
    input: string
    hook: string
  }

  // A fake T3: writes `report` where the preload would, prints `out`.
  function client(report: object | null, out: Partial<ExecResult>) {
    const seen: Seen[] = []
    const run: T3Run = async (bin, args, env, input) => {
      seen.push({ bin, args, env, input, hook: readFileSync(fileURLToPath(args[1]), 'utf8') })
      if (report) {
        writeFileSync(env.PILOTD_T3_REPORT, JSON.stringify(report))
      }
      return { code: 0, stdout: '', stderr: '', ...out }
    }
    return {
      seen,
      startThread: t3CliClient({ launcher: launcherPath, hookPath: HOOK, run }).startThread
    }
  }
  const STARTED = { stdout: '{"threadId":"mcp:1","projectId":"p","runId":"r"}\n' }

  it("runs T3's bundled CLI with pilotd's preload, bound to the worktree, the prompt on stdin", async () => {
    const t3 = client(
      { launch: true, rewritten: true, projectId: 'p', worktreePath: '/w/web/x', error: null },
      STARTED
    )
    await expect(t3.startThread(PLAN, 'the prompt')).resolves.toEqual({
      threadId: 'mcp:1',
      projectId: 'p',
      runId: 'r'
    })
    const [{ bin, args, env, input, hook }] = t3.seen
    expect(bin).toBe(APP)
    expect(args.slice(2)).toEqual([
      CLI,
      'thread',
      'start',
      '--title',
      'Job · item',
      '--provider',
      'claudeAgent',
      '--model',
      'opus',
      '--worktree',
      'pilotd: existing worktree',
      '--json',
      '/r/web',
      '-'
    ])
    expect(args[0]).toBe('--import')
    expect(input).toBe('the prompt')
    expect(hook).toContain(`export const SENTINEL = "${T3_SENTINEL}";`)
    expect(env).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      T3CODE_CLI_PATH: launcherPath,
      T3CODE_HOME: '/h/.t3',
      PILOTD_T3_PROJECT_ROOT: '/r/web',
      PILOTD_T3_WORKTREE: '/w/web/x',
      PILOTD_T3_BRANCH: 'feat/x',
      PILOTD_T3_REPORT: env.PILOTD_T3_REPORT
    })
  })

  it('passes the sentinel for the main checkout too, with no worktree to bind', async () => {
    const t3 = client({ launch: true, rewritten: true, worktreePath: null }, STARTED)
    await t3.startThread({ ...PLAN, worktree: null, branch: null, model: null }, 'the prompt')
    const [{ args, env }] = t3.seen
    expect(args.slice(3)).toEqual([
      'thread',
      'start',
      '--title',
      'Job · item',
      '--worktree',
      T3_SENTINEL,
      '--json',
      '/r/web',
      '-'
    ])
    expect([env.PILOTD_T3_WORKTREE, env.PILOTD_T3_BRANCH]).toEqual([undefined, undefined])
  })

  const notAProject =
    "no T3 project has repo web's main checkout /r/web as its root; add it in T3 (t3 project add /r/web) or run the step on herdr"
  it.each([
    [
      'the preload never saw the launch',
      { launch: false, rewritten: false },
      STARTED,
      "T3 thread mcp:1 started, but not through pilotd's preload: it may not be in /w/web/x or repo web's project"
    ],
    [
      'the preload wrote no report',
      null,
      STARTED,
      "T3 thread mcp:1 started, but not through pilotd's preload"
    ],
    [
      'no project has the checkout as its root',
      { launch: true, error: 'no T3 project has /r/web as its root' },
      { code: 1, stderr: 'Could not reach…' },
      `${notAProject} (no T3 project has /r/web as its root)`
    ],
    [
      't3 picked a parent folder',
      { launch: true, error: 't3 picked project p0 (/r), not p at /r/web' },
      { code: 1 },
      `${notAProject} (t3 picked project p0 (/r), not p at /r/web)`
    ],
    [
      'T3 matches no project',
      { launch: false },
      { code: 1, stderr: "No T3 Code project matches '/r/web'. Pass a project id.\n" },
      `${notAProject} (No T3 Code project matches '/r/web'. Pass a project id.)`
    ],
    [
      'T3 refuses the worktree',
      { launch: true, rewritten: true },
      { code: 1, stderr: "worktreePath must be one of the project's git worktrees." },
      "thread start failed: worktreePath must be one of the project's git worktrees."
    ],
    [
      'the CLI died before the preload',
      null,
      { code: 1, stderr: 'boom' },
      "thread start failed before pilotd's preload ran: boom"
    ]
  ])('fails closed when %s', async (_, report, out, message) => {
    await expect(client(report, out).startThread(PLAN, 'the prompt')).rejects.toThrow(message)
  })

  it("refuses a launcher that isn't T3's, and a Pilot without the preload", async () => {
    const other = join(dir, 'not-t3')
    writeFileSync(other, '#!/bin/sh\nexec t3 "$@"\n')
    const run: T3Run = async () => ({ code: 0, stdout: '', stderr: '' })
    await expect(
      t3CliClient({ launcher: other, hookPath: HOOK, run }).startThread(PLAN, 'p')
    ).rejects.toThrow(`t3 (${other}) isn't T3's launcher`)
    await expect(
      t3CliClient({ launcher: launcherPath, hookPath: null, run }).startThread(PLAN, 'p')
    ).rejects.toThrow('This Pilot ships no T3 preload')
  })
})
