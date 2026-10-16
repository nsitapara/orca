import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PILOTCLI_MISSING } from '../envs/pilotcli'
import type { PlaygroundChild } from './playground'
import { spawnPlayground } from './spawn'

// Tests only: a stand-in for `pilotcli self run-playground`. It records its argv, folder and ORCA_*/PILOT_* names,
// says its address on stderr, and serves until SIGTERM, when it prints its envelope and exits 0.
const SCRIPT = `#!/bin/sh
d="$FAKE_DIR"
printf '%s\\n' "$*" > "$d/args"
pwd -P > "$d/cwd"
env | grep -E '^(ORCA_|PILOT_)' | sort > "$d/env"
echo "pilotcli playground: http://127.0.0.1:4567/?token=ab12 (Ctrl-C stops it)" >&2
trap 'echo "{}"; exit 0' TERM
while :; do sleep 0.05; done
`

function fakeRunPlayground() {
  const dir = mkdtempSync(join(tmpdir(), 'fake-playground-'))
  const bin = join(dir, 'pilotcli')
  writeFileSync(bin, SCRIPT)
  chmodSync(bin, 0o755)
  return { dir, bin, read: (name: string) => readFileSync(join(dir, name), 'utf8').trim() }
}

function lineAndExit(child: PlaygroundChild) {
  const line = new Promise<string>((resolve) => child.onLine(resolve))
  const exit = new Promise<number | null>((resolve) => child.onExit(resolve))
  return { line, exit }
}

describe('spawnPlayground', () => {
  it("runs pilotcli's playground for the repo with pilotcli's env and Pilot's CLI for View source, and stops it", async () => {
    const fake = fakeRunPlayground()
    const spawn = spawnPlayground({
      binary: () => fake.bin,
      pilotBinDir: '/Applications/Pilot.app/Contents/Resources/bin',
      baseEnv: {
        PATH: `/Applications/Pilot.app/Contents/Resources/bin:${process.env.PATH ?? '/usr/bin:/bin'}`,
        ORCA_USER_DATA_PATH: '/pilot/data',
        PILOT_RUN_ID: 'r1',
        FAKE_DIR: fake.dir
      }
    })
    const child = spawn('/r/web')
    if ('error' in child) {
      throw new Error(child.error)
    }
    const { line, exit } = lineAndExit(child)
    expect(await line).toBe(
      'pilotcli playground: http://127.0.0.1:4567/?token=ab12 (Ctrl-C stops it)'
    )
    child.signal('SIGTERM')
    expect(await exit).toBe(0)
    expect(fake.read('args')).toBe('self run-playground -C /r/web --open false')
    expect(fake.read('cwd')).toBe(homedir())
    expect(fake.read('env')).toBe('ORCA_CLI_BIN_DIR=/Applications/Pilot.app/Contents/Resources/bin')
  })

  it('says pilotcli is missing', () => {
    expect(spawnPlayground({ binary: () => null, pilotBinDir: '/bin' })('/r/web')).toEqual({
      error: PILOTCLI_MISSING
    })
  })
})
