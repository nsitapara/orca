import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { readReply, type PilotcliReply } from './envelope'

export type { PilotcliOutcome, PilotcliReply } from './envelope'
export type PilotcliCall = {
  args: readonly string[]
  timeoutMs: number
  signal?: AbortSignal
  pidFile?: string
  // A command that lists a lot (artifacts list-artifacts) raises it; its JSON cut short would read as nothing.
  maxOutputBytes?: number
}
export type Pilotcli = (call: PilotcliCall) => Promise<PilotcliReply>

export const PILOTCLI_MISSING =
  "pilotcli isn't installed: put it at ~/.local/bin/pilotcli or on PATH, or name it in PILOT_PILOTCLI"
const MAX_OUTPUT_BYTES = 1024 * 1024
// sh writes its own pid, then becomes pilotcli (exec keeps the pid), so the pid file names pilotcli's process group: after
// a crash, the next start can stop a create the stopped Pilot left running (main/envs/recover.ts).
const WITH_PID_FILE = 'printf %s "$$" > "$1" && shift && exec "$@"'

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK)
    return statSync(path).isFile()
  } catch {
    return false
  }
}

// Where pilotcli is: PILOT_PILOTCLI when set (used as given), else ~/.local/bin/pilotcli, else the first on PATH. Read
// at each call, so installing it later needs no restart. Packaged Pilot's PATH is hydrated from the login shell.
// PATH entries that aren't absolute are skipped.
export function pilotcliPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  executable: (path: string) => boolean = isExecutable
): string | null {
  const configured = env.PILOT_PILOTCLI?.trim()
  if (configured) {
    return configured.replace(/^~(?=\/|$)/, home)
  }
  const local = join(home, '.local', 'bin', 'pilotcli')
  if (executable(local)) {
    return local
  }
  for (const dir of (env.PATH ?? '').split(':').filter((dir) => isAbsolute(dir))) {
    const candidate = join(dir, 'pilotcli')
    if (executable(candidate)) {
      return candidate
    }
  }
  return null
}

// pilotcli asks Pilot, then real Orca, whether Nish is busy there (worktree check free), reaching each only by its
// configured path (paths.pilot, paths.orca), never by this env's routing. So its env loses Pilot's routing (ORCA_*,
// PILOT_*) and Pilot's launcher folder on PATH (engine-env.ts adds both for scripts). It marks its calls as Pilot's own
// for pilotcli's telemetry.
export function pilotcliEnv(base: NodeJS.ProcessEnv, pilotBinDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(base)) {
    if (!/^(ORCA_|PILOT_)/.test(name)) {
      env[name] = value
    }
  }
  const dirs = (base.PATH ?? '').split(':').filter((dir) => dir !== '' && dir !== pilotBinDir)
  env.PATH = dirs.join(':')
  // pilotcli's telemetry records these calls as Pilot's own (caller app): the PILOT_* that would say so are gone.
  env.PILOTCLI_CALLER = 'pilot-app'
  return env
}

// Each call runs in its own process group (terminationBarrier): a timeout or an abort stops pilotcli and all it started.
export function pilotcliRunner(opts: {
  pilotBinDir: string
  binary?: () => string | null
  baseEnv?: NodeJS.ProcessEnv
}): Pilotcli {
  return async (call) => {
    const binary = (opts.binary ?? (() => pilotcliPath(opts.baseEnv ?? process.env)))()
    if (!binary) {
      return { outcome: 'failed', reason: PILOTCLI_MISSING, data: null, code: null }
    }
    const what = call.args.slice(0, 2).join(' ')
    const target = call.pidFile
      ? {
          program: '/bin/sh',
          args: ['-c', WITH_PID_FILE, 'pilotcli', call.pidFile, binary, ...call.args]
        }
      : { program: binary, args: [...call.args] }
    try {
      const ran = await runProcess(
        {
          ...target,
          cwd: homedir(),
          env: pilotcliEnv(opts.baseEnv ?? process.env, opts.pilotBinDir),
          timeoutMs: call.timeoutMs,
          signal: call.signal,
          maxOutputBytes: call.maxOutputBytes ?? MAX_OUTPUT_BYTES,
          terminationBarrier: true
        },
        'tail'
      )
      return readReply(ran, what, call.timeoutMs)
    } catch (error) {
      return {
        outcome: 'failed',
        reason: `pilotcli ${what} couldn't start: ${messageOf(error)}`,
        data: null,
        code: null
      }
    }
  }
}
