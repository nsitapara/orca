import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
import { spawnProcess } from '@orca/process-host'
import { PILOTCLI_MISSING, pilotcliEnv } from '../envs/pilotcli'
import type { PlaygroundChild } from './playground'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// `pilotcli self run-playground` for a repo, in its own process group, so a signal reaches the commands it runs too.
// Its env is pilotcli's (pilotcli talks to real Orca), plus ORCA_CLI_BIN_DIR: the one place its View source looks
// for an orca CLI, so files open in Pilot.
export function spawnPlayground(opts: {
  binary: () => string | null
  pilotBinDir: string
  baseEnv?: NodeJS.ProcessEnv
}): (repoPath: string) => PlaygroundChild | { error: string } {
  return (repoPath) => {
    const binary = opts.binary()
    if (!binary) {
      return { error: PILOTCLI_MISSING }
    }
    const env = {
      ...pilotcliEnv(opts.baseEnv ?? process.env, opts.pilotBinDir),
      ORCA_CLI_BIN_DIR: opts.pilotBinDir
    }
    let proc: ReturnType<typeof spawnProcess>
    try {
      proc = spawnProcess({
        program: binary,
        args: ['self', 'run-playground', '-C', repoPath, '--open', 'false'],
        cwd: homedir(),
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    } catch (error) {
      return { error: `pilotcli self run-playground couldn't start: ${messageOf(error)}` }
    }
    // The streams are ours (process-host): an unhandled error event would take the main process down.
    proc.stdout?.on('error', () => {})
    proc.stderr?.on('error', () => {})
    proc.stdout?.resume()
    const lines = proc.stderr ? createInterface({ input: proc.stderr }) : null
    let exited: ((code: number | null) => void) | null = null
    let done = false
    const finish = (code: number | null): void => {
      if (!done) {
        done = true
        exited?.(code)
      }
    }
    proc.on('error', () => finish(null))
    // close, not exit: by then every stderr line has been read, so a failure's reason is its last line.
    proc.on('close', (code) => finish(code))
    return {
      onLine: (listener) => lines?.on('line', listener),
      onExit: (listener) => {
        exited = listener
      },
      signal: (signal) => {
        if (proc.pid !== undefined && !done) {
          try {
            process.kill(-proc.pid, signal)
          } catch {
            // Already gone.
          }
        }
      }
    }
  }
}
