import type { PlaygroundProject, PlaygroundStatus } from '../../shared/playground-types'

// The running `pilotcli self run-playground`, as the service needs it: its stderr lines, its exit, and signals to
// its process group.
export type PlaygroundChild = {
  onLine: (listener: (line: string) => void) => void
  onExit: (listener: (code: number | null) => void) => void
  signal: (signal: 'SIGTERM' | 'SIGKILL') => void
}

export type PlaygroundDeps = {
  repos: () => { path: string; displayName: string }[]
  // The pilotcli project a repo is, or null when pilotcli doesn't know it.
  projectOf: (repoPath: string) => Promise<string | null>
  spawn: (repoPath: string) => PlaygroundChild | { error: string }
  startTimeoutMs?: number
}

export type PlaygroundService = {
  projects: () => Promise<PlaygroundProject[]>
  status: () => PlaygroundStatus
  start: (repoPath: string) => Promise<PlaygroundStatus>
  stop: (killAfterMs?: number) => Promise<PlaygroundStatus>
  close: () => void
}

// The line run-playground prints once it serves (pilotCLI's playground spec §1).
const READY = /^pilotcli playground: (http:\/\/127\.0\.0\.1:\d+\/\?token=[0-9a-f]+)/
const START_TIMEOUT_MS = 20_000
// A run in progress holds a stopped playground up to its own 2 minutes; Pilot doesn't wait that long.
const KILL_AFTER_MS = 5_000

function exitReason(code: number | null, lastLine: string): string {
  const how = code === null ? 'killed' : `exit ${code}`
  return lastLine
    ? `pilotcli playground exited (${how}): ${lastLine}`
    : `pilotcli playground exited (${how})`
}

// One playground at a time. It is running once its address line appears, and stopped when it exits: after a Stop
// from Pilot or from its page without a reason, otherwise with its last line.
export function playgroundService(deps: PlaygroundDeps): PlaygroundService {
  let status: PlaygroundStatus = { state: 'stopped', repoPath: null, reason: null }
  let child: PlaygroundChild | null = null
  let stopAsked = false
  // Who waits for the next change: a start for running or stopped, a stop for stopped.
  let waiters: (() => void)[] = []
  const current = (): PlaygroundStatus => status
  const settle = (next: PlaygroundStatus): void => {
    status = next
    const woken = waiters
    waiters = []
    woken.forEach((wake) => wake())
  }
  const changed = (): Promise<void> => new Promise((wake) => waiters.push(wake))

  async function projects(): Promise<PlaygroundProject[]> {
    const named = await Promise.all(
      deps.repos().map(async (repo) => ({ repo, project: await deps.projectOf(repo.path) }))
    )
    return named.flatMap(({ repo, project }) =>
      project === null ? [] : [{ path: repo.path, name: repo.displayName, project }]
    )
  }

  function watch(spawned: PlaygroundChild, repoPath: string): void {
    let lastLine = ''
    spawned.onLine((line) => {
      const text = line.trim()
      lastLine = text || lastLine
      const ready = READY.exec(text)
      if (ready && child === spawned && current().state === 'starting') {
        settle({ state: 'running', repoPath, url: ready[1] })
      }
    })
    spawned.onExit((code) => {
      if (child !== spawned) {
        return
      }
      child = null
      const quiet = stopAsked || (current().state === 'running' && code === 0)
      settle({ state: 'stopped', repoPath, reason: quiet ? null : exitReason(code, lastLine) })
    })
  }

  async function start(repoPath: string): Promise<PlaygroundStatus> {
    const before = current()
    if (before.state !== 'stopped') {
      if (before.repoPath === repoPath) {
        return before
      }
      throw new Error(`Stop the playground for ${before.repoPath} first`)
    }
    status = { state: 'starting', repoPath }
    // Whatever stops the check (no repos yet, a refused repo) leaves the playground stopped, so a later Start works.
    try {
      if (!(await projects()).some((p) => p.path === repoPath)) {
        throw new Error(`${repoPath} isn't a project pilotcli knows`)
      }
    } catch (error) {
      status = before
      throw error
    }
    const spawned = deps.spawn(repoPath)
    if ('error' in spawned) {
      settle({ state: 'stopped', repoPath, reason: spawned.error })
      return current()
    }
    child = spawned
    stopAsked = false
    watch(spawned, repoPath)
    const ms = deps.startTimeoutMs ?? START_TIMEOUT_MS
    const timer = setTimeout(() => {
      if (child === spawned && current().state === 'starting') {
        child = null
        spawned.signal('SIGTERM')
        settle({
          state: 'stopped',
          repoPath,
          reason: `pilotcli playground didn't start within ${ms / 1000}s`
        })
      }
    }, ms)
    if (current().state === 'starting') {
      await changed()
    }
    clearTimeout(timer)
    return current()
  }

  async function stop(killAfterMs = KILL_AFTER_MS): Promise<PlaygroundStatus> {
    const running = child
    if (!running) {
      return current()
    }
    stopAsked = true
    running.signal('SIGTERM')
    const timer = setTimeout(() => {
      if (child === running) {
        running.signal('SIGKILL')
      }
    }, killAfterMs)
    await changed()
    clearTimeout(timer)
    return current()
  }

  return {
    projects,
    status: current,
    start,
    stop,
    // Pilot is quitting: the playground stops with it, and nothing waits.
    close: () => {
      if (child) {
        stopAsked = true
        child.signal('SIGTERM')
      }
    }
  }
}
