import { runProcess } from '@orca/process-host'
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

// No typecheck runs this long, so an older lock outlived its owner (or its pid was reused).
const STALE_AFTER_MS = 2 * 60 * 60 * 1000

// The lock every worktree of this repository shares; null outside a git checkout.
export async function repoTypecheckLockDir(root) {
  try {
    const result = await runProcess({
      program: 'git',
      args: ['rev-parse', '--git-common-dir'],
      cwd: root
    })
    return result.code === 0
      ? join(resolve(root, result.stdout.trim()), 'orca-typecheck.lock')
      : null
  } catch {
    return null
  }
}

function readOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'))
  } catch {
    return null
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function isStale(owner, now) {
  return owner === null || !isAlive(owner.pid) || now - owner.startedAt > STALE_AFTER_MS
}

// The owner file is written before the rename, so a lock is never seen without its owner.
function tryTake(lockDir, owner) {
  const staging = mkdtempSync(`${lockDir}-`)
  writeFileSync(join(staging, 'owner.json'), JSON.stringify(owner))
  try {
    renameSync(staging, lockDir)
    return true
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    if (existsSync(lockDir)) {
      return false
    }
    throw error
  }
}

/**
 * Waits until no other worktree of this repository is typechecking, then holds the lock.
 * Returns the release function; a run killed outright leaves a lock the next run clears.
 */
export async function acquireTypecheckLock(
  lockDir,
  { worktree, pollMs = 2000, log = console.error, now = Date.now } = {}
) {
  const me = { pid: process.pid, worktree, startedAt: now() }
  let announced = false
  while (!tryTake(lockDir, me)) {
    const owner = readOwner(lockDir)
    if (isStale(owner, now())) {
      // Re-read so a lock another waiter just took over isn't removed.
      if (readOwner(lockDir)?.pid === owner?.pid) {
        rmSync(lockDir, { recursive: true, force: true })
      }
      continue
    }
    if (!announced) {
      log(
        `typecheck: waiting for the typecheck in ${owner.worktree} (pid ${owner.pid}); lock ${lockDir}`
      )
      announced = true
    }
    await sleep(pollMs)
  }
  let held = true
  return () => {
    if (held && readOwner(lockDir)?.pid === process.pid) {
      rmSync(lockDir, { recursive: true, force: true })
    }
    held = false
  }
}
