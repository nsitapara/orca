import { homedir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { actionFailed, type ActionOutcome, type ActionResult, type ActionRunOpts } from './types'

export type ProcessResultLike = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}
export type ProcessRun = (spec: {
  program: string
  args: string[]
  env: NodeJS.ProcessEnv
  timeoutMs: number
}) => Promise<ProcessResultLike>

export type ActBridge = {
  // act.py's own positional arguments (the `argv` of a catalog action's args object).
  run(script: string, argv: string[], opts: ActionRunOpts): Promise<ActionResult>
  // What run() spawns for a real (not dry) run: program, act.py, then actRunArgs. A card's Run line.
  command(script: string, argv: string[]): string[]
  describe(script: string, argv: string[]): Promise<string>
  refresh(script: string, argv: string[]): Promise<{ argv: string[]; changed: string } | null>
}

// act.py's arguments for `run`: run() spawns these, and command() shows them.
export function actRunArgs(script: string, argv: string[], dryRun: boolean): string[] {
  return [script, 'run', ...argv, ...(dryRun ? ['--dry-run'] : [])]
}

export const RUN_TIMEOUT_MS = 10 * 60_000
const QUICK_TIMEOUT_MS = 60_000
const OUTCOMES = new Set<string>(['done', 'failed', 'stale', 'needs_agent', 'not_yet'])

export function defaultActPy(env: NodeJS.ProcessEnv = process.env): string {
  return env.PILOT_ACT_PY ?? join(homedir(), '.agents', 'skills', 'worktree-gate', 'act.py')
}

// act.py routes `run` back into Pilot inside a Pilot run (Task 22c). Pilot's own act.py must never do that,
// so it gets PILOT_BRIDGE=1 and no PILOT_RUN_ID; AGENT_RUN tags its events with the run that asked.
export function bridgeEnv(base: NodeJS.ProcessEnv, runId: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, PILOT_BRIDGE: '1', AGENT_RUN: runId ?? 'pilot' }
  delete env.PILOT_RUN_ID
  return env
}

function lastJsonObject(stdout: string): Record<string, unknown> | null {
  for (const line of stdout.trim().split('\n').toReversed()) {
    try {
      const value: unknown = JSON.parse(line)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>
      }
    } catch {
      continue
    }
  }
  return null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function parseRunOutput(result: ProcessResultLike): ActionResult {
  if (result.timedOut) {
    return actionFailed(`act.py timed out after ${RUN_TIMEOUT_MS / 60_000} min`)
  }
  const data = lastJsonObject(result.stdout)
  const outcome =
    typeof data?.outcome === 'string' && OUTCOMES.has(data.outcome) ? data.outcome : null
  if (!data || !outcome) {
    const said = (result.stderr || result.stdout).trim().slice(-300)
    return actionFailed(`act.py exited ${result.code}: ${said}`)
  }
  return {
    outcome: outcome as ActionOutcome,
    detail: text(data.detail) ?? '',
    link: text(data.link),
    log: text(data.log),
    onYou: data.on_you === true
  }
}

// Also used by the vault reader (Task 27b): one place spawns Pilot's Python helpers.
export const runWithProcessHost: ProcessRun = async (spec) => {
  const r = await runProcess({
    program: spec.program,
    args: spec.args,
    env: spec.env,
    timeoutMs: spec.timeoutMs
  })
  return { code: r.code, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut }
}

export function actBridge(
  opts: { actPy?: string; python?: string; run?: ProcessRun; env?: NodeJS.ProcessEnv } = {}
): ActBridge {
  const run = opts.run ?? runWithProcessHost
  const program = opts.python ?? process.env.PILOT_PYTHON ?? 'python3'
  const actPy = opts.actPy ?? defaultActPy()
  const call = (args: string[], runId: string | null, timeoutMs: number) =>
    run({
      program,
      args: [actPy, ...args],
      env: bridgeEnv(opts.env ?? process.env, runId),
      timeoutMs
    })
  // A process that couldn't start answers like a crash: run fails, describe and refresh fall back.
  const quiet = async (args: string[]): Promise<ProcessResultLike | null> =>
    call(args, null, QUICK_TIMEOUT_MS).catch(() => null)
  return {
    command: (script, args) => [program, actPy, ...actRunArgs(script, args, false)],
    async run(script, args, { dryRun, runId }) {
      try {
        return parseRunOutput(await call(actRunArgs(script, args, dryRun), runId, RUN_TIMEOUT_MS))
      } catch (error) {
        return actionFailed(`act.py couldn't start: ${messageOf(error)}`)
      }
    },
    async describe(script, args) {
      const r = await quiet([script, 'describe', ...args])
      return r?.code === 0 && r.stdout.trim() ? r.stdout.trim() : [script, ...args].join(' ')
    },
    async refresh(script, args) {
      const r = await quiet([script, 'refresh', ...args])
      const data = r?.code === 0 ? lastJsonObject(r.stdout) : null
      if (!data || !Array.isArray(data.args) || typeof data.changed !== 'string') {
        return null
      }
      return { argv: data.args.map(String), changed: data.changed }
    }
  }
}
