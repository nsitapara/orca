import type { StepStatus } from '../../shared/api-types'
import type { StepDef } from '../../shared/definition/types'
import { formatDuration } from '../../shared/run/format-duration'
import type { ResultRead } from '../../shared/run/step-result'
import { lastLine } from '../last-line'

export const OUTPUT_TAIL_CHARS = 8192
export const STDOUT_NOT_KEPT = '(stdout not kept: it may hold comment or ticket text)'

export type ShellResult = {
  code: number | null
  signal: string | null
  stdout: string
  stderr: string
  timedOut: boolean
  // The capture passed 1 MiB and kept only its tail (runProcess's outputTruncated).
  truncated?: boolean
}

// May Pilot keep any of stdout (in output_tail, or as a last line in an error)? Not for a result marked meta.text, nor
// for a capture cut at 1 MiB that reads as no result: a cut envelope can't be read, so it can't be told from a text one.
export function keepsStdout(result: ShellResult, read: ResultRead): boolean {
  if (read.text) {
    return false
  }
  return read.stored !== null || result.truncated !== true
}

// The last 8 KB of what the step printed, stderr after stdout; stdout Pilot may not keep is replaced by a note.
export function outputTail(result: ShellResult, read: ResultRead): string {
  const stdout = keepsStdout(result, read) ? result.stdout : STDOUT_NOT_KEPT
  const both = result.stderr.trim() ? `${stdout}\n--- stderr ---\n${result.stderr}` : stdout
  return both.length > OUTPUT_TAIL_CHARS ? both.slice(-OUTPUT_TAIL_CHARS) : both
}

// What the step said last: stderr's last line, else its result's reason, else stdout's last line (only when stdout is
// no envelope and may be kept: an envelope's JSON is never an error message).
function saidLast(result: ShellResult, read: ResultRead): string {
  const stdout = read.stored === null && keepsStdout(result, read) ? lastLine(result.stdout) : ''
  return lastLine(result.stderr) || read.reason || stdout
}

// exit_codes.ok → done, skip → skipped (the run goes on), stop → stopped (the run ends: nothing to do; the reason is the
// envelope's, else what it said last), anything else → failed with what it said last. A timeout is timed_out whatever
// the code.
export function shellEnding(
  step: Pick<StepDef, 'exitCodes'>,
  result: ShellResult,
  timeoutMs: number | null,
  read: ResultRead
): { status: StepStatus; error: string | null } {
  if (result.timedOut) {
    return { status: 'timed_out', error: `Timed out after ${formatDuration(timeoutMs ?? 0)}` }
  }
  const last = saidLast(result, read)
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
  if (step.exitCodes.stop.includes(result.code)) {
    return { status: 'stopped', error: read.reason || last || `Exited ${result.code}` }
  }
  return { status: 'failed', error: `Exited ${result.code}${said}` }
}
