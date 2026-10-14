import { readFile, rm } from 'node:fs/promises'
import { runProcess } from '@orca/process-host'

// Upstream's orcad-serve-parity integration test SIGKILLs orcad, so the `--serve` browser host orcad
// started (/Applications/Orca.app when it is installed) outlives the run: it listens on every interface
// and blocks Orca's updater. config/vitest.config.ts (pilot-hook: vitest-orcad-sidecar-sweep) runs this
// sweep before and after every run. It stops only orphans this repo's Vitest started, never a live one.

export type Sidecar = { pid: number; dataDir: string }

export type SweepIo = {
  list: () => Promise<string>
  environment: (pid: number) => Promise<string>
  stop: (pid: number) => Promise<void>
}

const DATA_DIR =
  /(?:^|\s)--user-data-dir=((?:\/private)?\/tmp\/orcad-browser-[A-Za-z0-9]{6})(?:\s|$)/
// test.env in config/vitest.config.ts sets it, and orcad passes it on to the browser host it starts.
const VITEST_MARKER = /(?:^|[\s\0])ORCA_VITEST_RUNTIME=/
const STOP_GRACE_MS = 5_000

/** Browser hosts orcad started (a `--serve` process on an orcad-browser profile) whose parent is gone. */
export function orphanedSidecars(psOutput: string): Sidecar[] {
  return psOutput.split('\n').flatMap((line) => {
    const row = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (!row || row[2] !== '1' || !/\s--serve(?:\s|$)/.test(row[3])) {
      return []
    }
    const dataDir = DATA_DIR.exec(row[3])?.[1]
    return dataDir ? [{ pid: Number(row[1]), dataDir }] : []
  })
}

/** Stops each orphaned browser host Vitest started and removes its profile. Returns how many it stopped. */
export async function sweepLeakedSidecars(io: SweepIo = hostIo): Promise<number> {
  let stopped = 0
  for (const sidecar of orphanedSidecars(await io.list())) {
    if (!VITEST_MARKER.test(await io.environment(sidecar.pid))) {
      continue
    }
    await io.stop(sidecar.pid)
    await rm(sidecar.dataDir, { recursive: true, force: true })
    stopped++
  }
  return stopped
}

async function psOutput(args: string[]): Promise<string> {
  const result = await runProcess({ program: 'ps', args, timeoutMs: 10_000 })
  return result.code === 0 ? result.stdout : ''
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name)
  } catch {
    // Already gone.
  }
}

async function stopProcess(pid: number): Promise<void> {
  signal(pid, 'SIGTERM')
  const deadline = Date.now() + STOP_GRACE_MS
  while (isAlive(pid) && Date.now() < deadline) {
    await new Promise((settle) => setTimeout(settle, 100))
  }
  signal(pid, 'SIGKILL')
}

const hostIo: SweepIo = {
  list: () => psOutput(['-A', '-ww', '-o', 'pid=,ppid=,command=']),
  environment: async (pid) => {
    if (process.platform === 'linux') {
      return readFile(`/proc/${pid}/environ`, 'utf8').catch(() => '')
    }
    return psOutput(['-E', '-ww', '-o', 'command=', '-p', String(pid)])
  },
  stop: stopProcess
}

export default async function setup(): Promise<() => Promise<void>> {
  const sweep = async (): Promise<void> => {
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
      return
    }
    const stopped = await sweepLeakedSidecars()
    if (stopped > 0) {
      console.warn(`[pilot] stopped ${stopped} orphaned orcad browser host(s) a test left running`)
    }
  }
  await sweep()
  return sweep
}
