import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run } from '../../scripts/run.mjs'

const read = (p: string): string[] => readFileSync(join(import.meta.dirname, p), 'utf8').split('\n')
const upstream = read('../../../../../resources/darwin/bin/orca')

function diff(lines: string[]): string[] {
  const rest = [...lines]
  const out: string[] = []
  for (const u of upstream) {
    const i = rest.indexOf(u)
    if (i === -1) {
      out.push(`- ${u}`)
    } else {
      rest.splice(i, 1)
    }
  }
  return [...out, ...rest.filter((l) => l !== '').map((l) => `+ ${l}`)]
}

describe('launcher drift from resources/darwin/bin/orca', () => {
  // "Install CLI" links /usr/local/bin/pilot to bin/orca (upstream's bundled-cli-launcher-path.ts), so
  // bin/orca must pin Pilot's data folder too, or the installed `pilot` would act on real Orca's.
  it('bin/orca differs only in the Pilot executable, error text and the two Pilot pins', () => {
    expect(diff(read('orca'))).toEqual([
      '- \techo "Unable to determine Orca.app path from symlink: ${BASH_SOURCE[0]}"',
      '- ELECTRON="$CONTENTS/MacOS/Orca"',
      `+ # Pilot: always act on Pilot's data folder and install as \`pilot\`, never on real Orca's. "Install CLI"`,
      '+ # links /usr/local/bin/pilot to this launcher, and `pilot serve` re-installs the CLI on start.',
      '+ export ORCA_USER_DATA_PATH="$HOME/Library/Application Support/Pilot"',
      '+ export ORCA_CLI_INSTALL_PATH=/usr/local/bin/pilot',
      '+ \techo "Unable to determine Pilot.app path from symlink: ${BASH_SOURCE[0]}"',
      '+ ELECTRON="$CONTENTS/MacOS/Pilot"'
    ])
  })

  it('pins both before anything else runs', () => {
    expect(read('orca').slice(3, 6)).toEqual([
      'export ORCA_USER_DATA_PATH="$HOME/Library/Application Support/Pilot"',
      'export ORCA_CLI_INSTALL_PATH=/usr/local/bin/pilot',
      'set -euo pipefail'
    ])
  })

  it('bin/pilot is the same launcher as bin/orca', () => {
    expect(read('pilot')).toEqual(read('orca'))
  })
})

// A fake Pilot.app whose "Electron" prints the two variables, run the way Install CLI wires it: through
// /usr/local/bin/pilot → bin/orca, from a shell that points at real Orca's folder.
describe('the installed pilot command', () => {
  it("acts on Pilot's folder and installs as pilot, whatever the shell says", () => {
    const root = mkdtempSync(join(tmpdir(), 'pilot-launcher-'))
    try {
      const contents = join(root, 'Pilot.app', 'Contents')
      mkdirSync(join(contents, 'MacOS'), { recursive: true })
      mkdirSync(join(contents, 'Resources', 'bin'), { recursive: true })
      const fake = join(contents, 'MacOS', 'Pilot')
      writeFileSync(fake, '#!/bin/sh\necho "$ORCA_USER_DATA_PATH|$ORCA_CLI_INSTALL_PATH"\n')
      chmodSync(fake, 0o755)
      const launcher = join(contents, 'Resources', 'bin', 'orca')
      copyFileSync(join(import.meta.dirname, 'orca'), launcher)
      chmodSync(launcher, 0o755)
      const installed = join(root, 'pilot')
      symlinkSync(launcher, installed)
      const r = run(installed, ['status'], {
        env: {
          PATH: process.env.PATH,
          HOME: '/h',
          ORCA_USER_DATA_PATH: '/h/Library/Application Support/orca',
          ORCA_CLI_INSTALL_PATH: '/usr/local/bin/orca'
        }
      })
      expect(r.code).toBe(0)
      expect(r.stdout.trim()).toBe('/h/Library/Application Support/Pilot|/usr/local/bin/pilot')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// A fake unpacked Linux Pilot whose "Electron" prints the two variables, run through ~/.local/bin/pilot-desktop →
// resources/bin/orca-ide, the path the app hands its terminals.
describe('the Linux launcher', () => {
  function runLinux(extraEnv: Record<string, string>): { code: number; stdout: string } {
    const root = mkdtempSync(join(tmpdir(), 'pilot-linux-launcher-'))
    try {
      mkdirSync(join(root, 'resources', 'bin'), { recursive: true })
      const fake = join(root, 'pilot')
      writeFileSync(fake, '#!/bin/sh\necho "$ORCA_USER_DATA_PATH|$ORCA_CLI_INSTALL_PATH"\n')
      chmodSync(fake, 0o755)
      const launcher = join(root, 'resources', 'bin', 'orca-ide')
      copyFileSync(join(import.meta.dirname, 'pilot-linux'), launcher)
      chmodSync(launcher, 0o755)
      const installed = join(root, 'pilot-desktop')
      symlinkSync(launcher, installed)
      return run(installed, ['status'], {
        env: {
          PATH: process.env.PATH,
          HOME: '/h',
          ORCA_USER_DATA_PATH: '/h/.config/orca',
          ORCA_CLI_INSTALL_PATH: '/h/.local/bin/orca-ide',
          ...extraEnv
        }
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }

  it("acts on Pilot's folder and installs as pilot-desktop, whatever the shell says", () => {
    const r = runLinux({})
    expect(r.code).toBe(0)
    expect(r.stdout.trim()).toBe('/h/.config/Pilot|/h/.local/bin/pilot-desktop')
  })

  it("follows XDG_CONFIG_HOME, as Electron's userData does", () => {
    expect(runLinux({ XDG_CONFIG_HOME: '/x' }).stdout.trim()).toBe(
      '/x/Pilot|/h/.local/bin/pilot-desktop'
    )
  })
})
