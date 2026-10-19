import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'

// Worker-thread module; must stay electron-free (plain-Node entry guard).

const SAMPLE_PROGRAM = '/usr/bin/sample'
const SAMPLE_SECONDS = 3
// Why: symbolication runs after the 3 s capture and slows down on a loaded machine.
const SAMPLE_PROCESS_TIMEOUT_MS = 60_000
const SAMPLE_FILE_PREFIX = 'main-thread-sample-'
// Why bounded: one sample of this app is ~0.5 MB, and repeated stalls must not fill the disk.
export const MAX_STACK_SAMPLES_KEPT = 10
// Why: escalating stalls recur every minute or two before a freeze; one early sample per window is enough.
export const STALL_SAMPLE_MIN_INTERVAL_MS = 10 * 60_000

export type StackSampleKind = 'stall' | 'hang'

export type RunSampleProgram = (program: string, args: string[]) => Promise<{ code: number | null }>

export type StackSample = {
  path: string
  /** Settles true once `sample` has written the file. */
  done: Promise<boolean>
}

export type MainThreadStackSampler = {
  /** Starts a sample of the parent process, or returns null when one is running or not due. */
  capture: (kind: StackSampleKind) => StackSample | null
}

function sampleFileName(at: number, kind: StackSampleKind): string {
  // Why no colons: the name sorts by time and is valid on every filesystem.
  return `${SAMPLE_FILE_PREFIX}${new Date(at).toISOString().replace(/[:.]/g, '-')}-${kind}.txt`
}

function pruneOldSamples(sampleDir: string, keep: number): void {
  const samples = readdirSync(sampleDir)
    .filter((name) => name.startsWith(SAMPLE_FILE_PREFIX) && name.endsWith('.txt'))
    .sort()
  for (const name of samples.slice(0, Math.max(0, samples.length - keep))) {
    rmSync(join(sampleDir, name), { force: true })
  }
}

function runSampleProgram(program: string, args: string[]): Promise<{ code: number | null }> {
  return runProcess({
    program,
    args,
    timeoutMs: SAMPLE_PROCESS_TIMEOUT_MS,
    maxOutputBytes: 4_096
  })
}

// Why `sample` from this worker: the main thread it inspects is the one that is stuck, and the
// native stack shows where it is blocked (a syscall, a lock, AppKit, V8 GC or JIT code).
export function createMainThreadStackSampler(options: {
  parentPid: number
  sampleDir: string
  now: () => number
  run?: RunSampleProgram
}): MainThreadStackSampler {
  const run = options.run ?? runSampleProgram
  let running = false
  let lastStallSampleAt: number | null = null
  return {
    capture: (kind) => {
      const now = options.now()
      if (running) {
        return null
      }
      if (
        kind === 'stall' &&
        lastStallSampleAt !== null &&
        now - lastStallSampleAt < STALL_SAMPLE_MIN_INTERVAL_MS
      ) {
        return null
      }
      const samplePath = join(options.sampleDir, sampleFileName(now, kind))
      try {
        mkdirSync(options.sampleDir, { recursive: true })
        pruneOldSamples(options.sampleDir, MAX_STACK_SAMPLES_KEPT - 1)
      } catch {
        // Why: diagnostics are best-effort; an unwritable logs directory must not stop the watchdog.
        return null
      }
      if (kind === 'stall') {
        lastStallSampleAt = now
      }
      running = true
      const args = [String(options.parentPid), String(SAMPLE_SECONDS), '-file', samplePath]
      let pending: Promise<{ code: number | null }>
      try {
        pending = run(SAMPLE_PROGRAM, args)
      } catch {
        running = false
        return null
      }
      const done = pending.then(
        (result) => result.code === 0,
        // A missing or failed `sample` leaves no file; the marker's path then names nothing.
        () => false
      )
      void done.finally(() => {
        running = false
      })
      return { path: samplePath, done }
    }
  }
}
