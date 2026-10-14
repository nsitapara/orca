import { readFileSync, rmSync } from 'node:fs'
import { runProcessSync } from '@orca/process-host'

const TERM_WAIT_MS = 10_000
const POLL_MS = 200

export type OrphanDeps = {
  read(pidFile: string): string | null
  commandOf(pid: number): string | null
  kill(pid: number, signal: NodeJS.Signals): void
  alive(pid: number): boolean
  sleep(ms: number): Promise<void>
}
const REAL: OrphanDeps = {
  read: (file) => {
    try {
      return readFileSync(file, 'utf8')
    } catch {
      return null
    }
  },
  commandOf: (pid) => {
    try {
      const ps = runProcessSync({
        program: 'ps',
        args: ['-o', 'command=', '-p', String(pid)],
        timeoutMs: 2000
      })
      return ps.code === 0 && !ps.timedOut ? ps.stdout.trim() : null
    } catch {
      return null
    }
  },
  kill: (pid, signal) => {
    try {
      process.kill(pid, signal)
    } catch {
      // already gone
    }
  },
  alive: (pid) => {
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}

// The command line of `pilotcli env create … --run <runId> …`, word for word (a substring would take r10 for r1).
function isCreateOf(command: string, runId: string): boolean {
  const words = command.trim().split(/\s+/)
  const at = words.indexOf('create')
  return (
    at > 0 &&
    words[at - 1] === 'env' &&
    words.some((word, i) => word === '--run' && words[i + 1] === runId)
  )
}

// A create a crashed Pilot left running (its group named by the pid file, main/envs/pilotcli.ts) is stopped before its
// env is deleted. Only a process whose command line is still this very create is signalled: a pid the OS reused is never
// touched. The second safeguard; the first is env delete's own not_yet (Contract answers 5).
export async function stopOrphanCreate(
  pidFile: string,
  runId: string,
  deps: OrphanDeps = REAL
): Promise<void> {
  const pid = Number.parseInt(deps.read(pidFile) ?? '', 10)
  const command = Number.isInteger(pid) && pid > 1 ? deps.commandOf(pid) : null
  if (command !== null && isCreateOf(command, runId)) {
    deps.kill(-pid, 'SIGTERM')
    for (let waited = 0; waited < TERM_WAIT_MS && deps.alive(pid); waited += POLL_MS) {
      await deps.sleep(POLL_MS)
    }
    if (deps.alive(pid)) {
      deps.kill(-pid, 'SIGKILL')
    }
  }
  rmSync(pidFile, { force: true })
}
