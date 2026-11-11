import { spawn } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { cleanChildEnv } from './foreign-launch'

export type ExecResult = { code: number; stdout: string; stderr: string }
// Runs `<bin> <args>` (no shell), with `input` on stdin when given.
export type Exec = (args: readonly string[], input?: string) => Promise<ExecResult>

const EXEC_TIMEOUT_MS = 60_000

// The env the CLI runs under: Pilot's own, without a parent session's markers or herdr's pane context, plus `extra`.
export function cliExec(bin: string, extra: Record<string, string> = {}): Exec {
  const env = () => cleanChildEnv(process.env, extra)
  return (args, input) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, [...args], {
        env: env(),
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: EXEC_TIMEOUT_MS
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
      child.on('error', reject)
      // A process that exits (or never starts) before reading stdin: its close or error settles the call.
      child.stdin.on('error', () => undefined)
      child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }))
      child.stdin.end(input ?? '')
    })
}

// Starts a long-lived process detached from Pilot (its own process group), its output appended to `log`.
export function spawnDetached(
  bin: string,
  args: readonly string[],
  log: string,
  extra: Record<string, string> = {}
): void {
  const out = openSync(log, 'a')
  const child = spawn(bin, [...args], {
    env: cleanChildEnv(process.env, extra),
    stdio: ['ignore', out, out],
    detached: true
  })
  closeSync(out)
  child.unref()
}
