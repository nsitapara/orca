import {
  closeSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import type { StepStatus } from '../../shared/api-types'
import type { StepDef } from '../../shared/definition/types'
import { formatDuration } from '../../shared/run/format-duration'
import { outputsFromFile } from '../../shared/run/outputs'
import {
  RUN_PLACEHOLDER_ADVICE,
  renderShellEnv,
  runPlaceholders
} from '../../shared/run/shell-template'
import { engineChildEnv, type EngineEnv } from '../engine-env'
import { resolveScriptCommand } from '../fields/script-runner'
import type { PilotStore } from '../store/store'
export { ORPHAN_SHELL_OUTCOME, sweepOrphanShellSteps } from './shell-sweep'
import type { StepStarter, StepStartRequest } from './advance'
import { lastLine } from '../last-line'

export const SHELL_CAPTURE_BYTES = 1024 * 1024
export const OUTPUT_TAIL_CHARS = 8192

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
// Past 1 MiB the output keeps its tail, where a command's last words usually are.
export const runShell: ShellRunner = async (spec) => {
  const result = await runProcess(
    {
      program: '/bin/sh',
      args: ['-c', spec.command],
      cwd: spec.cwd,
      env: spec.env,
      timeoutMs: spec.timeoutMs,
      maxOutputBytes: SHELL_CAPTURE_BYTES,
      // Its own process group (detached), and on a timeout the whole tree is stopped, not just /bin/sh.
      terminationBarrier: true
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
  const last = lastLine(result.stderr) || lastLine(result.stdout)
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

// The tail of the outputs file, at most SHELL_CAPTURE_BYTES (the last line per key wins, so the tail is
// what counts); a cut first line is dropped.
function readOutputsFile(file: string): string {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const start = Math.max(0, size - SHELL_CAPTURE_BYTES)
    const buffer = Buffer.alloc(size - start)
    readSync(fd, buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8')
    if (start === 0) {
      return text
    }
    const cut = text.indexOf('\n')
    return cut === -1 ? '' : text.slice(cut + 1)
  } finally {
    closeSync(fd)
  }
}

const keyOf = (runId: string, idx: number): string => `${runId}#${idx}`

export function makeShellSteps(deps: ShellStepDeps): ShellSteps {
  const run = deps.run ?? runShell
  const live = new Set<string>()
  const inflight = new Set<Promise<void>>()

  function finish(
    req: StepStartRequest,
    result: ShellResult,
    timeoutMs: number | null,
    outputFile: string
  ): void {
    const step = req.definition.steps[req.idx]
    let written = ''
    try {
      written = readOutputsFile(outputFile)
    } catch (error) {
      deps.log(
        `[pilot] run ${req.run.id}: step ${step.name}: couldn't read its outputs: ${messageOf(error)}`
      )
    }
    const { outputs, warnings } = outputsFromFile(written)
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
    // run: is used as written: values reach the command only through env: (the load check refuses a
    // placeholder in run:, so one here means a definition that skipped it).
    const command = resolveScriptCommand(step.run ?? '', req.definition.file)
    if (runPlaceholders(command).length > 0) {
      throw new Error(`Shell step ${step.name}: run ${RUN_PLACEHOLDER_ADVICE}`)
    }
    const stepEnv = renderShellEnv(step.env, req.fields)
    if (!stepEnv.ok) {
      throw new Error(
        `Shell step ${step.name}: no value for ${stepEnv.missing.map((n) => `{${n}}`).join(', ')}`
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
    // The step reports outputs by appending key=value lines to $PILOT_OUTPUT_FILE, in a private folder.
    let outputDir: string
    let outputFile: string
    try {
      outputDir = mkdtempSync(join(tmpdir(), 'pilot-step-'))
      outputFile = join(outputDir, 'outputs')
      writeFileSync(outputFile, '', { mode: 0o600 })
    } catch (error) {
      fail(req, error)
      throw error
    }
    const key = keyOf(req.run.id, req.idx)
    live.add(key)
    let job: Promise<void>
    try {
      deps.store.runs.updateStep(req.run.id, req.idx, { status: 'running' })
      const timeoutMs = deps.timeoutOf(req)
      const base = deps.baseEnv ?? process.env
      job = run({
        command,
        cwd,
        env: {
          ...base,
          ...engineChildEnv(deps.engineEnv, deps.envOf(req), base),
          ...stepEnv.env,
          PILOT_OUTPUT_FILE: outputFile
        },
        timeoutMs
      })
        .then(
          (result) => finish(req, result, timeoutMs, outputFile),
          (error: unknown) => fail(req, error)
        )
        .catch((error: unknown) =>
          deps.log(
            `[pilot] run ${req.run.id}: couldn't record step ${step.name}: ${messageOf(error)}`
          )
        )
        .finally(() => {
          try {
            rmSync(outputDir, { recursive: true, force: true })
          } catch (error) {
            deps.log(`[pilot] couldn't remove ${outputDir}: ${messageOf(error)}`)
          }
          live.delete(key)
          inflight.delete(job)
          deps.onEnded(req.run.id)
        })
    } catch (error) {
      try {
        rmSync(outputDir, { recursive: true, force: true })
      } catch (removeError) {
        deps.log(`[pilot] couldn't remove ${outputDir}: ${messageOf(removeError)}`)
      }
      live.delete(key)
      fail(req, error)
      throw error
    }
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
