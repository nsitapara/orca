import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cliExec } from './foreign-exec'
import type { ForeignLaunch } from './foreign-launch'
import { foreignLaunchers } from './foreign-wiring'

// Drives the running T3 Code app (pilotd's tests/t3_smoke.rs, through Pilot's own path): PILOT_T3_SMOKE=1 pnpm exec
// vitest run --config config/vitest.config.ts src/packages/pilot/src/main/run/t3-launch.smoke.test.ts. It adds a
// throwaway repo as a T3 project and removes it (and its threads) at the end; no real project is touched. Re-run it
// after a T3 update.
const t3 = cliExec(join(homedir(), '.t3', 'bin', 't3'))
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function show(thread: string): Promise<Record<string, unknown>> {
  const { code, stdout, stderr } = await t3(['thread', 'show', '--json', '--messages', '2', thread])
  expect(code, stderr).toBe(0)
  return JSON.parse(stdout) as Record<string, unknown>
}

// The thread's latest assistant reply, waiting up to 3 minutes for it.
async function replyOf(thread: string): Promise<string> {
  for (let i = 0; i < 90; i += 1) {
    const messages = (await show(thread)).messages as { role: string; text?: string }[] | undefined
    const reply = messages?.findLast((m) => m.role === 'assistant')?.text
    if (reply) {
      return reply
    }
    await pause(2000)
  }
  return ''
}

describe.skipIf(process.env.PILOT_T3_SMOKE !== '1')('t3 hand-over (real T3)', () => {
  it("opens a thread in the repo's T3 project, running in the run's existing worktree", async () => {
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'pilot-t3-smoke-')))
    const repo = join(tmp, 'repo')
    const worktree = join(tmp, 'worktrees', 'smoke-branch')
    mkdirSync(repo)
    git(repo, 'init', '-q')
    git(
      repo,
      '-c',
      'user.name=pilot',
      '-c',
      'user.email=pilot@example.invalid',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'init'
    )
    git(repo, 'worktree', 'add', '-q', '-b', 'pilot-smoke', worktree)
    const launch = foreignLaunchers({
      dataDir: tmp,
      now: Date.now,
      checkoutOf: async () => repo,
      resourcesDir: fileURLToPath(new URL('../../../resources', import.meta.url))
    }).t3
    const step: ForeignLaunch = {
      system: 't3',
      agent: 'claude',
      runId: 'smoke',
      stepIdx: 0,
      repo: 'pilot-smoke',
      cwd: worktree,
      title: '[Automation] Pilot t3 smoke',
      prompt:
        'This is an automated smoke test. Run `pwd` once and reply with its output only; do nothing else.',
      env: {},
      argv: [],
      args: []
    }

    // Not a T3 project yet: refused, and no thread is made.
    await expect(launch(step)).rejects.toThrow("no T3 project has repo pilot-smoke's main checkout")

    const added = await t3(['project', 'add', '--title', 'pilot-smoke-throwaway', repo])
    expect(added.code, added.stderr).toBe(0)
    const projectId = added.stdout.split(/\s+/)[2]
    let threadId: string | null = null
    try {
      const launched = await launch(step)
      threadId = launched.externalRef
      console.log('launched', launched)
      expect(launched.detail).toMatchObject({
        projectId,
        projectRoot: repo,
        worktreePath: worktree
      })
      const thread = (await show(launched.externalRef)).thread as Record<string, unknown>
      expect(thread).toMatchObject({ projectId, worktreePath: worktree, branch: 'pilot-smoke' })
      const reply = await replyOf(launched.externalRef)
      console.log('agent replied', reply)
      expect(reply).toContain(worktree)
    } finally {
      const removed = await t3(['project', 'remove', '--force', repo])
      console.log('cleanup', removed.code, removed.stdout.trim(), removed.stderr.trim())
      rmSync(tmp, { recursive: true, force: true })
    }
    // The thread went with its project.
    expect(threadId).not.toBeNull()
    const gone = await t3(['thread', 'show', '--json', threadId ?? ''])
    expect(gone.code).not.toBe(0)
    expect(gone.stderr).toContain('is no longer available')
  }, 300_000)
})
