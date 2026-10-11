import { dirname, resolve } from 'node:path'
import { runProcess } from '@orca/process-host'
import { shellQuote } from '../../shared/shell-quote'

export type ScriptRequest = {
  command: string
  cwd: string
  stdin: string
  env: Record<string, string>
  timeoutMs: number
}
export type ScriptResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}
export type ScriptRunner = (req: ScriptRequest) => Promise<ScriptResult>

const MAX_OUTPUT_BYTES = 1024 * 1024

// "./fields/x.sh …" and "../x.sh …" resolve against the automation file's folder; anything else (an
// absolute path, a command on PATH) is left as written.
export function resolveScriptCommand(command: string, automationFile: string): string {
  const text = command.trim()
  const match = /^(\.\.?\/\S*)([\s\S]*)$/.exec(text)
  if (!match) {
    return text
  }
  return `${shellQuote(resolve(dirname(automationFile), match[1]))}${match[2]}`
}

// /bin/sh -c through Orca's process host (no child_process in Pilot's main code). Rejects only when
// the shell can't be started; a non-zero exit or a timeout is data.
export const runShellScript: ScriptRunner = async (req) => {
  const result = await runProcess({
    program: '/bin/sh',
    args: ['-c', req.command],
    cwd: req.cwd,
    env: { ...process.env, ...req.env },
    input: req.stdin,
    timeoutMs: req.timeoutMs,
    maxOutputBytes: MAX_OUTPUT_BYTES
  })
  return {
    code: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut
  }
}
