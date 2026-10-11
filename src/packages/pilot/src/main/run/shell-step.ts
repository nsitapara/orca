import { runProcess } from '@orca/process-host'
import type { StepStatus } from '../../shared/api-types'
import type { StepDef } from '../../shared/definition/types'
import { formatDuration } from '../../shared/run/format-duration'
import { OUTPUT_LINE_PREFIX, outputsFromStdout } from '../../shared/run/outputs'
import { renderShellCommand } from '../../shared/run/shell-template'
import { engineChildEnv, type EngineEnv } from '../engine-env'
import { resolveScriptCommand } from '../fields/script-runner'
import type { PilotStore } from '../store/store'
import type { StepStarter, StepStartRequest } from './advance'

export const SHELL_CAPTURE_BYTES = 1024 * 1024
export const OUTPUT_TAIL_CHARS = 8192
export const ORPHAN_SHELL_OUTCOME = 'Pilot stopped while this shell step ran'

export type ShellSpec = {
  command: string
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number | null
}
export type ShellResult = {
  code: number | null
  signal: string | null
  stdout: string
  stderr: string
  timedOut: boolean
}
export type ShellRunner = (spec: ShellSpec) => Promise<ShellResult>

// /bin/sh -c through Orca's process host, in its own process group so a timeout stops the whole tree.
// Past 1 MiB the output keeps its tail, where ::pilot-output lines usually are.
export const runShell: ShellRunner = async (spec) => {
  const result = await runProcess(
    {
      program: '/bin/sh',
      args: ['-c', spec.command],
      cwd: spec.cwd,
      env: spec.env,
      timeoutMs: spec.timeoutMs,
      maxOutputBytes: SHELL_CAPTURE_BYTES,
      detached: true
    },
    'tail'
  )
  return {
    code: result.code,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut
  }
}

export type ShellStepDeps = {
  store: PilotStore
  now(): number
  workspaceOf(req: StepStartRequest): Promise<{ path: string }>
  // The §8 step env (Task 8c's pilotStepEnv); engineChildEnv puts Pilot's bin and data folder around it.
  envOf(req: StepStartRequest): Record<string, string>
  engineEnv: EngineEnv
  timeoutOf(req: StepStartRequest): number | null
  onEnded(runId: string): void
  log(message: string): void
  run?: ShellRunner
  // The env every command starts from; process.env (PATH already hydrated from the login shell).
  baseEnv?: NodeJS.ProcessEnv
}
export type ShellSteps = {
  start: StepStarter
  isLive(runId: string, idx: number): boolean
  settled(): Promise<void>
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function lastLine(text: string): string | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith(OUTPUT_LINE_PREFIX.trim()))
  return lines.at(-1) ?? null
}

export function outputTail(stdout: string, stderr: string): string {
  const both = stderr.trim() ? `${stdout}\n--- stderr ---\n${stderr}` : stdout
  return both.length > OUTPUT_TAIL_CHARS ? both.slice(-OUTPUT_TAIL_CHARS) : both
}

// exit_codes.ok → done, exit_codes.skip → skipped (the run goes on), anything else → failed with the
// last line it printed (stderr first). A timeout is timed_out whatever the code.
export function shellEnding(
  step: Pick<StepDef, 'exitCodes'>,
  result: ShellResult,
  timeoutMs: number | null
): { status: StepStatus; error: string | null } {
  if (result.timedOut) {
    return { status: 'timed_out', error: `Timed out after ${formatDuration(timeoutMs ?? 0)}` }
  }
  const last = lastLine(result.stderr) ?? lastLine(result.stdout)
  const said = last ? `: ${last}` : ''
  if (result.code === null) {
    return { status: 'failed', error: `Stopped by ${result.signal ?? 'a signal'}${said}` }
  }
  if (step.exitCodes.ok.includes(result.code)) {
    return { status: 'done', error: null }
  }
  if (step.exitCodes.skip.includes(result.code)) {
    return { status: 'skipped', error: `Exited ${result.code} (skip)${said}` }
  }
  return { status: 'failed', error: `Exited ${result.code}${said}` }
}

const keyOf = (runId: string, idx: number): string => `${runId}#${idx}`

export function makeShellSteps(deps: ShellStepDeps): ShellSteps {
  const run = deps.run ?? runShell
  const live = new Set<string>()
  const inflight = new Set<Promise<void>>()

  function finish(req: StepStartRequest, result: ShellResult, timeoutMs: number | null): void {
    const step = req.definition.steps[req.idx]
    const { outputs, warnings } = outputsFromStdout(result.stdout)
    for (const warning of warnings) {
      deps.log(`[pilot] run ${req.run.id}: step ${step.name}: ${warning}`)
    }
    if (Object.keys(outputs).length > 0) {
      deps.store.advance.mergeStepOutputs(req.run.id, req.idx, outputs)
    }
    const ending = shellEnding(step, result, timeoutMs)
    deps.store.runs.updateStep(req.run.id, req.idx, {
      status: ending.status,
      finishedAt: deps.now(),
      exitCode: result.code,
      outputTail: outputTail(result.stdout, result.stderr),
      ...(ending.error ? { error: ending.error } : {})
    })
  }

  function fail(req: StepStartRequest, error: unknown): void {
    deps.store.runs.updateStep(req.run.id, req.idx, {
      status: 'failed',
      finishedAt: deps.now(),
      error: messageOf(error)
    })
  }

  // Writes the step's row (or takes over the `pending` one the engine wrote for step 0), resolves the
  // workspace, starts the process and returns; the process's end writes the result and calls onEnded.
  // Throws (row failed) when the step can't start. A command with an unfilled placeholder throws before
  // anything is written here; the engine fails the step's pending row, if it has one.
  async function start(req: StepStartRequest): Promise<void> {
    const step = req.definition.steps[req.idx]
    const rendered = renderShellCommand(
      resolveScriptCommand(step.run ?? '', req.definition.file),
      req.fields
    )
    if (!rendered.ok) {
      throw new Error(
        `Shell step ${step.name}: no value for ${rendered.missing.map((n) => `{${n}}`).join(', ')}`
      )
    }
    if (!deps.store.runs.steps(req.run.id).some((s) => s.idx === req.idx)) {
      deps.store.runs.createStep({
        runId: req.run.id,
        idx: req.idx,
        name: step.name,
        agent: 'shell',
        skill: null,
        startedAt: deps.now(),
        kind: 'shell',
        whenExpr: step.when
      })
    }
    let cwd: string
    try {
      cwd = (await deps.workspaceOf(req)).path
    } catch (error) {
      fail(req, error)
      throw error
    }
    const key = keyOf(req.run.id, req.idx)
    live.add(key)
    deps.store.runs.updateStep(req.run.id, req.idx, { status: 'running' })
    const timeoutMs = deps.timeoutOf(req)
    const base = deps.baseEnv ?? process.env
    const job: Promise<void> = run({
      command: rendered.command,
      cwd,
      env: { ...base, ...engineChildEnv(deps.engineEnv, deps.envOf(req), base) },
      timeoutMs
    })
      .then(
        (result) => finish(req, result, timeoutMs),
        (error: unknown) => fail(req, error)
      )
      .catch((error: unknown) =>
        deps.log(
          `[pilot] run ${req.run.id}: couldn't record step ${step.name}: ${messageOf(error)}`
        )
      )
      .finally(() => {
        live.delete(key)
        inflight.delete(job)
        deps.onEnded(req.run.id)
      })
    inflight.add(job)
  }

  return {
    start,
    isLive: (runId, idx) => live.has(keyOf(runId, idx)),
    async settled() {
      while (inflight.size > 0) {
        await Promise.all(inflight)
      }
    }
  }
}

// A shell step 'running' with no process in this Pilot belonged to a Pilot that has stopped: its
// process went with it. The step fails; advanceIdle then ends the run (always steps still run).
export function sweepOrphanShellSteps(
  store: PilotStore,
  isLive: (runId: string, idx: number) => boolean,
  now: () => number,
  log: (message: string) => void
): void {
  let steps: ReturnType<PilotStore['runs']['runningSteps']>
  try {
    steps = store.runs.runningSteps()
  } catch (error) {
    log(`[pilot] couldn't sweep shell steps: ${messageOf(error)}`)
    return
  }
  for (const step of steps) {
    if (step.kind !== 'shell' || step.status !== 'running' || isLive(step.runId, step.idx)) {
      continue
    }
    try {
      store.runs.updateStep(step.runId, step.idx, {
        status: 'failed',
        finishedAt: now(),
        error: ORPHAN_SHELL_OUTCOME
      })
      log(`[pilot] run ${step.runId}: step ${step.name}: ${ORPHAN_SHELL_OUTCOME}`)
    } catch (error) {
      log(`[pilot] couldn't close shell step ${step.runId}/${step.idx}: ${messageOf(error)}`)
    }
  }
}
