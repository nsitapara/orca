import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Tests only: a stand-in for pilotcli; no test ever runs the real one. A call appends its argv to calls.log, the
// ORCA_*/PILOT_* names it sees to env.log, its PATH to path.log and its PILOTCLI_CALLER to
// caller.log. When <verb>.sleep exists, it writes its pid to <verb>.pid and sleeps that many seconds. Then it
// prints <verb>.json (stdout) and <verb>.stderr, and exits <verb>.code (default 0). <verb> is its first two words (FakeVerb), such as env-create or gitlab-check-mr.
const SCRIPT = `#!/bin/sh
d="$FAKE_PILOTCLI_DIR"
v="$1-$2"
printf '%s\\n' "$*" >> "$d/calls.log"
env | grep -E '^(ORCA_|PILOT_)' | cut -d= -f1 >> "$d/env.log"
printf '%s\\n' "$PATH" > "$d/path.log"
printf '%s\\n' "\${PILOTCLI_CALLER-}" >> "$d/caller.log"
if [ -f "$d/$v.sleep" ]; then printf %s "$$" > "$d/$v.pid"; sleep "$(cat "$d/$v.sleep")"; fi
if [ -f "$d/$v.json" ]; then cat "$d/$v.json"; fi
if [ -f "$d/$v.stderr" ]; then cat "$d/$v.stderr" >&2; fi
exit "$(cat "$d/$v.code" 2>/dev/null || echo 0)"
`
export type FakeReply = { json?: unknown; code?: number; stderr?: string; sleep?: number }
export type FakeVerb =
  | 'env-create'
  | 'env-delete'
  | 'env-list'
  | 'git-push-branch'
  | 'gitlab-get-mr'
  | 'gitlab-check-mr'
  | 'gitlab-update-mr'
  | 'self-list-commands'
  | 'self-get-telemetry'
  | 'self-list-telemetry-calls'
export type FakePilotcli = {
  bin: string
  dir: string
  env: NodeJS.ProcessEnv
  answer(verb: FakeVerb, reply: FakeReply): void
  calls(): string[]
  read(name: string): string
}

export function fakePilotcli(): FakePilotcli {
  const dir = mkdtempSync(join(tmpdir(), 'fake-pilotcli-'))
  const bin = join(dir, 'pilotcli')
  writeFileSync(bin, SCRIPT)
  chmodSync(bin, 0o755)
  const read = (name: string) =>
    existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : ''
  return {
    bin,
    dir,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', FAKE_PILOTCLI_DIR: dir },
    answer(verb, reply) {
      if (reply.json !== undefined) {
        writeFileSync(join(dir, `${verb}.json`), JSON.stringify(reply.json))
      }
      if (reply.code !== undefined) {
        writeFileSync(join(dir, `${verb}.code`), String(reply.code))
      }
      if (reply.stderr !== undefined) {
        writeFileSync(join(dir, `${verb}.stderr`), reply.stderr)
      }
      if (reply.sleep !== undefined) {
        writeFileSync(join(dir, `${verb}.sleep`), String(reply.sleep))
      }
    },
    calls: () => read('calls.log').split('\n').filter(Boolean),
    read
  }
}
