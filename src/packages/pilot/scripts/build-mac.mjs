#!/usr/bin/env node
// Packaged macOS build of Pilot with the wrapper config. Unsigned local build (--dir), like Orca's local builds.
import { join } from 'node:path'
import { runInherit } from './run.mjs'

// Swift helper steps run with a `swift` shim first on PATH (see scripts/shims/swift).
const shimsDir = join(import.meta.dirname, 'shims')
const SWIFT_STEPS = new Set([
  'build:computer-macos',
  'build:keyboard-layout-macos',
  'build:notification-status-macos'
])

function stepEnv(args) {
  const env = { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }
  if (SWIFT_STEPS.has(args[1])) {
    env.PILOT_REAL_PATH = process.env.PATH ?? ''
    env.PATH = `${shimsDir}:${process.env.PATH ?? ''}`
  }
  return env
}

const steps = [
  ['pnpm', ['run', 'build:desktop']],
  ['pnpm', ['run', 'build:computer-macos']],
  ['pnpm', ['run', 'build:keyboard-layout-macos']],
  ['pnpm', ['run', 'build:notification-status-macos']],
  ['pnpm', ['run', 'ensure:electron-runtime']],
  [
    'pnpm',
    [
      'exec',
      'electron-builder',
      '--config',
      'src/packages/pilot/build/electron-builder.config.cjs',
      '--mac',
      '--dir'
    ]
  ]
]
for (const [cmd, args] of steps) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const code = await runInherit(cmd, args, { env: stepEnv(args) })
  if (code !== 0) {
    process.exit(code)
  }
}
console.log('\nBuilt. The app is under dist/mac*/Pilot.app. Copy it to /Applications to install.')
