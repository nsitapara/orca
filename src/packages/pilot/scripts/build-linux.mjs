#!/usr/bin/env node
// Packaged Linux build of Pilot with the wrapper config (--linux dir: one machine, no AppImage/deb/rpm), then
// installs it (install-linux.mjs). Needs Docker: Orca's Wayland clipboard helper and node-pty's glibc 2.28 slot
// are built in containers. Flags: --no-install, --scheduler off|pinned|on|default.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { constants, setPriority } from 'node:os'
import { runInherit } from './run.mjs'
import { installPilotLinux } from './install-linux.mjs'

const ARCH = { x64: 'x64', arm64: 'arm64' }[process.arch]
if (process.platform !== 'linux' || !ARCH) {
  console.error('build-linux.mjs builds Pilot for this Linux machine (x64 or arm64) only.')
  process.exit(1)
}
const argv = process.argv.slice(2)
const schedulerFlag = argv.includes('--scheduler')
  ? argv[argv.indexOf('--scheduler') + 1]
  : undefined
if (schedulerFlag !== undefined && !['off', 'pinned', 'on', 'default'].includes(schedulerFlag)) {
  console.error('--scheduler takes off, pinned, on or default (unset: the desktop default)')
  process.exit(1)
}

// The build shares the machine with the desktop: every step inherits a lowered priority.
setPriority(constants.priority.PRIORITY_BELOW_NORMAL)

const slot = join('out', 'orcad-prebuilds', `linux-${ARCH}-glibc`, 'pty.node')
const env = {
  ...process.env,
  // Caps the Go tools the build runs (the native tsc, esbuild) to a few cores.
  GOMAXPROCS: process.env.GOMAXPROCS ?? '4',
  PILOT_LINUX_PTY: join(process.cwd(), slot)
}

/** @type {[string, string[]][]} */
const steps = [
  ['pnpm', ['run', 'build:desktop']],
  ['bash', ['src/packages/pilot/scripts/machine-setup/build-pty-slot.sh', '--repo', process.cwd()]],
  ['pnpm', ['run', 'ensure:electron-runtime']],
  [
    'pnpm',
    [
      'exec',
      'electron-builder',
      '--config',
      'src/packages/pilot/build/electron-builder.config.cjs',
      '--linux',
      'dir',
      `--${ARCH}`
    ]
  ]
]
for (const [cmd, args] of steps) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const code = await runInherit(cmd, args, { env })
  if (code !== 0) {
    process.exit(code)
  }
}

const appDir = join('dist', ARCH === 'x64' ? 'linux-unpacked' : 'linux-arm64-unpacked')
if (!existsSync(join(appDir, 'pilot'))) {
  console.error(`No ${appDir}/pilot after the build`)
  process.exit(1)
}
if (argv.includes('--no-install')) {
  console.log(`\nBuilt ${appDir}. Not installed (--no-install).`)
} else {
  try {
    const text = await installPilotLinux({
      source: appDir,
      repo: process.cwd(),
      scheduler: schedulerFlag === 'default' ? null : schedulerFlag
    })
    console.log(`\n${text}`)
  } catch (error) {
    console.error(`\n${error.message}`)
    process.exit(1)
  }
}
