#!/usr/bin/env node
// Packaged macOS build of Pilot with the wrapper config. Ad hoc signed local build (--dir), sealed as dev.nsitapara.pilot.
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

function findBuiltApp() {
  const appDir = readdirSync('dist')
    .filter((d) => d.startsWith('mac'))
    .map((d) => `dist/${d}/Pilot.app`)
    .find((d) => readdirSync(`dist/${d.split('/')[1]}`).includes('Pilot.app'))
  if (!appDir) {
    console.error('Identity check: no dist/mac*/Pilot.app found')
    process.exit(1)
  }
  return appDir
}

// Why: TCC grants and the safe-storage Keychain item are keyed to this requirement. An ad hoc
// signature's default is its cdhash, which every build changes; the identifier survives rebuilds.
const PILOT_REQUIREMENT = `designated => identifier "${PILOT_BUNDLE_ID}"`

// Re-signs only the outer bundle: nested helpers have their own identifiers and would fail it.
function sealApp(appDir) {
  const r = run('codesign', [
    '--force',
    '--sign',
    '-',
    '--preserve-metadata=entitlements,flags',
    `-r=${PILOT_REQUIREMENT}`,
    appDir
  ])
  if (r.code !== 0) {
    console.error(`codesign ${appDir} failed: ${(r.stderr || r.stdout || '').trim()}`)
    process.exit(1)
  }
}

function verifyIdentities(appDir) {
  const bad = []
  const verify = run('codesign', ['--verify', '--deep', '--strict', appDir])
  if (verify.code !== 0) {
    bad.push(`${appDir}: invalid signature: ${(verify.stderr || verify.stdout || '').trim()}`)
  }
  const requirement = run('codesign', ['-d', '-r-', appDir])
  if (!`${requirement.stdout}${requirement.stderr}`.includes(PILOT_REQUIREMENT)) {
    bad.push(`${appDir}: designated requirement is not ${PILOT_REQUIREMENT}`)
  }
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
}

const appDir = findBuiltApp()
sealApp(appDir)
verifyIdentities(appDir)
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
