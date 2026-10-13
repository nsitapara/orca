import { dirname, resolve } from 'node:path'
import { runProcess } from '@orca/process-host'
import { z } from 'zod'
import { durationMs } from '../../shared/definition/duration'
import { idsFromProblems } from '../../shared/definition/ids-from'
import type { IdsFrom } from '../../shared/definition/types'
import { splitArgv } from '../../shared/run/argv'
import { engineChildEnv, type EngineEnv } from '../engine-env'

export type IdsCommand = {
  program: string
  args: string[]
  cwd: string
  env: Record<string, string>
  timeoutMs: number
  maxOutputBytes: number
}
export type IdsCommandResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  truncated: boolean
}
export type IdsRunner = (cmd: IdsCommand) => Promise<IdsCommandResult>
export type IdsFromOptions = {
  automationId: string
  // The automation's file: a ./ or ../ program resolves against its folder, as a script check's does.
  file: string
  repoPath: string
  engineEnv: EngineEnv
  baseEnv?: NodeJS.ProcessEnv
}

// Each of stdout and stderr; past it the command is stopped and the tick fails.
export const IDS_OUTPUT_CAP = 256 * 1024
// Each id is one GET; a list past this is a script bug, not a job's work.
export const MAX_IDS = 200
// The command's "no ids": an empty set, not a failure.
export const NO_IDS_EXIT = 3
const DEFAULT_TIMEOUT_MS = 60_000
const ID = /^[\x21-\x7e]{1,200}$/

// Inherited names that change how a shell, the dynamic loader or an interpreter starts; the YAML can't set them
// either (envNameProblem), so a value Pilot's own process carries never reaches the command.
const DROPPED = new Set([
  'IFS',
  'ENV',
  'BASH_ENV',
  'SHELLOPTS',
  'BASHOPTS',
  'PS4',
  'CDPATH',
  'GLOBIGNORE',
  'NODE_OPTIONS',
  'PERL5OPT',
  'PERL5LIB',
  'PYTHONSTARTUP',
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONINSPECT',
  'RUBYOPT',
  'JAVA_TOOL_OPTIONS',
  'GIT_SSH_COMMAND'
])
const DROPPED_PREFIX = /^(LD_|DYLD_|GIT_CONFIG_)/

export function inheritedIdsEnv(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && !DROPPED.has(name) && !DROPPED_PREFIX.test(name)) {
      env[name] = value
    }
  }
  return env
}

// Through Orca's process host: argv, never /bin/sh; its own process group, so a timeout stops what it started;
// stopped as soon as either stream passes the cap.
export const runIdsCommand: IdsRunner = async (cmd) => {
  const out = await runProcess({
    program: cmd.program,
    args: cmd.args,
    cwd: cmd.cwd,
    env: cmd.env,
    timeoutMs: cmd.timeoutMs,
    maxOutputBytes: cmd.maxOutputBytes,
    killOnOutputLimit: true,
    terminationBarrier: true
  })
  return {
    code: out.code,
    stdout: out.stdout,
    stderr: out.stderr,
    timedOut: out.timedOut,
    truncated: out.outputTruncated === true
  }
}

function lastLine(text: string): string {
  return text.trim().split('\n').at(-1)?.trim() ?? ''
}

// What stdout may be: the list itself, or an envelope (pilotcli's) whose data is the list. Only data is read.
const IdsOutput = z.union([
  z.array(z.unknown()),
  z.looseObject({ data: z.array(z.unknown()) }).transform((envelope) => envelope.data)
])
// An object entry: its keys, one of which is the id.
const IdsEntry = z.record(z.string(), z.unknown())

function listIn(parsed: unknown): unknown[] {
  const list = IdsOutput.safeParse(parsed)
  if (!list.success) {
    throw new Error('ids_from: expected a JSON list, or an envelope whose data is a list')
  }
  return list.data
}

function idOf(entry: unknown, field: string | undefined, n: number): string {
  if (field === undefined) {
    if (typeof entry !== 'string') {
      throw new Error(
        `ids_from: item ${n} is not a string (name a field: to pick the id from objects)`
      )
    }
    return entry
  }
  const object = Array.isArray(entry) ? null : IdsEntry.safeParse(entry)
  const value = object?.success ? object.data[field] : undefined
  if (typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value))) {
    return String(value)
  }
  throw new Error(`ids_from: item ${n} has no "${field}"`)
}

// The ids in stdout: a plain JSON list, or a pilotcli envelope ({v, command, outcome, reason, data, meta}) whose
// data is the list. Objects give the id at `field`; without one, each entry is the id. Repeats are kept once.
export function idsFromOutput(stdout: string, field: string | undefined): string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stdout)
  } catch {
    throw new Error("ids_from: its output isn't JSON")
  }
  const ids: string[] = []
  for (const [i, entry] of listIn(parsed).entries()) {
    const id = idOf(entry, field, i + 1)
    if (!ID.test(id)) {
      throw new Error(`ids_from: item ${i + 1} is not a usable id: ${JSON.stringify(id)}`)
    }
    if (!ids.includes(id)) {
      ids.push(id)
    }
  }
  if (ids.length > MAX_IDS) {
    throw new Error(`ids_from: more than ${MAX_IDS} ids`)
  }
  return ids
}

function commandOf(spec: IdsFrom, o: IdsFromOptions): IdsCommand {
  const problem = idsFromProblems(spec)[0]
  if (problem) {
    throw new Error(`ids_from: ${problem.message}`)
  }
  const split = splitArgv(spec.run)
  if (!split.ok) {
    throw new Error(`ids_from: ${split.error}`)
  }
  const [program, ...args] = split.argv
  const base = o.baseEnv ?? process.env
  return {
    program: /^\.\.?\//.test(program) ? resolve(dirname(o.file), program) : program,
    args,
    cwd: o.repoPath,
    env: {
      ...inheritedIdsEnv(base),
      ...engineChildEnv(o.engineEnv, { PILOT_AUTOMATION_ID: o.automationId }, base),
      ...spec.env
    },
    timeoutMs: (spec.timeout && durationMs(spec.timeout)) || DEFAULT_TIMEOUT_MS,
    maxOutputBytes: IDS_OUTPUT_CAP
  }
}

// One run of where.ids_from (contract: 0 = the ids, 3 = none, anything else fails the tick). Throws with the reason.
export async function readIdsFrom(
  spec: IdsFrom,
  o: IdsFromOptions,
  run: IdsRunner
): Promise<string[]> {
  const cmd = commandOf(spec, o)
  let out: IdsCommandResult
  try {
    out = await run(cmd)
  } catch (error) {
    throw new Error(
      `ids_from couldn't start: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (out.timedOut) {
    throw new Error(`ids_from timed out after ${Math.round(cmd.timeoutMs / 1000)}s`)
  }
  if (out.truncated) {
    throw new Error(`ids_from printed more than ${IDS_OUTPUT_CAP} bytes`)
  }
  if (out.code === NO_IDS_EXIT) {
    return []
  }
  if (out.code === null) {
    throw new Error('ids_from was stopped by a signal')
  }
  if (out.code !== 0) {
    const why = lastLine(out.stderr) || lastLine(out.stdout)
    throw new Error(why ? `ids_from exited ${out.code}: ${why}` : `ids_from exited ${out.code}`)
  }
  return idsFromOutput(out.stdout, spec.field)
}
