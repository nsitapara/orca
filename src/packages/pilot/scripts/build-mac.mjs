#!/usr/bin/env node
// Packaged macOS build of Pilot with the wrapper config. Unsigned local build (--dir), like Orca's local builds.
import { join } from 'node:path'
import { readdirSync } from 'node:fs'
import { constants, setPriority } from 'node:os'
import { run, runInherit } from './run.mjs'
import { installPilot, markNoIndex } from './install-mac.mjs'

const PILOT_BUNDLE_ID = 'dev.nsitapara.pilot'

// Swift helper steps run with a `swift` shim first on PATH (see scripts/shims/swift).
const shimsDir = join(import.meta.dirname, 'shims')
const SWIFT_STEPS = new Set(['build:keyboard-layout-macos', 'build:notification-status-macos'])

// The build shares the Mac with the desktop: every step inherits a lowered priority.
setPriority(constants.priority.PRIORITY_BELOW_NORMAL)

function stepEnv(args) {
  const env = {
    ...process.env,
    CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    // Caps the Go tools the build runs (the native tsc, esbuild) to a few cores.
    GOMAXPROCS: process.env.GOMAXPROCS ?? '4'
  }
  if (SWIFT_STEPS.has(args[1])) {
    env.PILOT_REAL_PATH = process.env.PATH ?? ''
    env.PATH = `${shimsDir}:${process.env.PATH ?? ''}`
  }
  return env
}

/** @type {[string, string[]][]} */
const steps = [
  ['pnpm', ['run', 'build:desktop']],
  // No build:computer-macos: Pilot ships without the Computer Use helper (README, Known gaps).
  ['pnpm', ['run', 'build:keyboard-layout-macos']],
  ['pnpm', ['run', 'build:notification-status-macos', '--', '--bundle-id', PILOT_BUNDLE_ID]],
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

// Fail the build if any bundle in the packaged app still carries Orca's identity.
function findInfoPlists(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      findInfoPlists(full, found)
    } else if (entry.name === 'Info.plist') {
      found.push(full)
    }
  }
  return found
}

function plistValue(plist, key) {
  const r = run('/usr/libexec/PlistBuddy', ['-c', `Print ${key}`, plist])
  return r.code === 0 ? r.stdout.trim() : null
}

// Returns the verified app path.
function verifyIdentities() {
  const appDir = readdirSync('dist')
    .filter((d) => d.startsWith('mac'))
    .map((d) => `dist/${d}/Pilot.app`)
    .find((d) => readdirSync(`dist/${d.split('/')[1]}`).includes('Pilot.app'))
  if (!appDir) {
    console.error('Identity check: no dist/mac*/Pilot.app found')
    process.exit(1)
  }
  const bad = []
  for (const plist of findInfoPlists(`${appDir}/Contents`)) {
    const id = plistValue(plist, 'CFBundleIdentifier')
    if (id?.startsWith('com.stablyai.orca')) {
      bad.push(`${plist}: ${id}`)
    }
  }
  const main = `${appDir}/Contents/Info.plist`
  for (let i = 0; i < 8; i++) {
    const schemes = plistValue(main, `CFBundleURLTypes:${i}:CFBundleURLSchemes`)
    if (schemes === null) {
      break
    }
    if (/\borca\b/.test(schemes)) {
      bad.push(`${main}: URL scheme orca in ${schemes.replace(/\s+/g, ' ')}`)
    }
  }
  if (bad.length > 0) {
    console.error(`\nIdentity check failed. Pilot would share Orca's identity:\n${bad.join('\n')}`)
    process.exit(1)
  }
  console.log(`\nIdentity check passed for ${appDir}`)
  return appDir
}

const appDir = verifyIdentities()
markNoIndex('dist')
const argv = process.argv.slice(2)
if (argv.includes('--no-install')) {
  console.log(`\nBuilt ${appDir}. Not installed (--no-install).`)
} else {
  try {
    const text = await installPilot({
      source: appDir,
      repo: process.cwd(),
      launch: !argv.includes('--no-launch')
    })
    console.log(`\n${text}`)
  } catch (error) {
    console.error(`\n${error.message}`)
    process.exit(1)
  }
}
