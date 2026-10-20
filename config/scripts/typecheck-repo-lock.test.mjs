import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { acquireTypecheckLock } from './typecheck-repo-lock.mjs'

const dirs = []
function lockPath() {
  const dir = mkdtempSync(join(tmpdir(), 'orca-typecheck-lock-'))
  dirs.push(dir)
  return join(dir, 'orca-typecheck.lock')
}

function leaveLock(lockDir, owner) {
  mkdirSync(lockDir)
  writeFileSync(join(lockDir, 'owner.json'), JSON.stringify(owner))
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('makes a second run wait for the first, naming its worktree once', async () => {
  const lockDir = lockPath()
  leaveLock(lockDir, { pid: process.ppid, worktree: '/wt/other', startedAt: Date.now() })
  const log = vi.fn()
  let acquired = false
  const second = acquireTypecheckLock(lockDir, { worktree: '/wt/me', pollMs: 5, log }).then(
    (release) => {
      acquired = true
      return release
    }
  )
  await vi.waitFor(() => expect(log).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve, 30))
  expect(acquired).toBe(false)
  expect(log.mock.calls).toEqual([
    [`typecheck: waiting for the typecheck in /wt/other (pid ${process.ppid}); lock ${lockDir}`]
  ])

  rmSync(lockDir, { recursive: true })
  const release = await second
  expect(existsSync(lockDir)).toBe(true)
  release()
  expect(existsSync(lockDir)).toBe(false)
})

it.each([
  ['a dead pid', { pid: 2 ** 22 + 7, startedAt: 0 }, 0],
  ['an alive pid older than two hours', { pid: process.ppid, startedAt: 0 }, 3 * 60 * 60 * 1000]
])('takes over a lock left by %s', async (_name, owner, now) => {
  const lockDir = lockPath()
  leaveLock(lockDir, { worktree: '/wt/gone', ...owner })
  const log = vi.fn()
  const release = await acquireTypecheckLock(lockDir, {
    worktree: '/wt/me',
    log,
    now: () => now
  })
  expect(log).not.toHaveBeenCalled()
  release()
  expect(existsSync(lockDir)).toBe(false)
})
