// Pilot's packaged build (D23). Requires Orca's config and overrides only identity, launchers and the
// update feed. Orca's file is never edited. Relative paths resolve against the repo root.
const { chmodSync, copyFileSync, existsSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const base = require('../../../../config/electron-builder.config.cjs')

const PILOT_BIN = 'src/packages/pilot/build/bin'
// Pilot's own static files (the token report's page), read from Contents/Resources/pilot (env.ts pilotResourcesDir).
const PILOT_RESOURCES = 'src/packages/pilot/resources'
const ORCA_LAUNCHER = 'resources/darwin/bin/orca'
const ORCA_LINUX_LAUNCHER = 'resources/linux/bin/orca-ide'
// Why: the helper keeps Orca's bundle id (shared TCC grants) and its peer check rejects Pilot.
const COMPUTER_USE_HELPER = 'Orca Computer Use.app'

function pilotMacResources(list) {
  const kept = (list ?? []).filter((r) => {
    const from = typeof r === 'string' ? r : r.from
    return from !== ORCA_LAUNCHER && !from.includes(COMPUTER_USE_HELPER)
  })
  return [
    ...kept,
    { from: `${PILOT_BIN}/orca`, to: 'bin/orca' },
    { from: `${PILOT_BIN}/pilot`, to: 'bin/pilot' },
    { from: PILOT_RESOURCES, to: 'pilot' }
  ]
}

// Linux: Pilot's launcher replaces Orca's at bin/orca-ide, the path the app hands its terminals
// (bundled-cli-launcher-path.ts), and ships again as bin/pilot.
function pilotLinuxResources(list) {
  const kept = (list ?? []).filter((r) => (typeof r === 'string' ? r : r.from) !== ORCA_LINUX_LAUNCHER)
  return [
    ...kept,
    { from: `${PILOT_BIN}/pilot-linux`, to: 'bin/orca-ide' },
    { from: `${PILOT_BIN}/pilot-linux`, to: 'bin/pilot' },
    { from: PILOT_RESOURCES, to: 'pilot' }
  ]
}

// Linux: the host's Electron rebuild of node-pty fails the glibc floor on a rolling distro (Arch). build-linux.mjs
// points PILOT_LINUX_PTY at node-pty's glibc 2.28 slot (build-pty-slot.sh), an N-API build Electron loads as is,
// and it replaces the packaged copy before Orca's afterPack checks the floor and boots the daemon on it.
function placeLinuxPty(context) {
  const slot = process.env.PILOT_LINUX_PTY
  if (context.electronPlatformName !== 'linux' || !slot) {
    return
  }
  const build = join(context.appOutDir, 'resources/node_modules/node-pty/build')
  if (!existsSync(slot) || !existsSync(build)) {
    throw new Error(`PILOT_LINUX_PTY: missing ${existsSync(slot) ? build : slot}`)
  }
  // Every copy: Orca's afterPack adopts build/orca-napi-<platform>-<arch> as build/Release (packaged-native-build-entries.cjs).
  const placed = []
  for (const dir of readdirSync(build)) {
    const target = join(build, dir, 'pty.node')
    if (existsSync(target)) {
      copyFileSync(slot, target)
      placed.push(dir)
    }
  }
  if (placed.length === 0) {
    throw new Error(`PILOT_LINUX_PTY: no pty.node under ${build}`)
  }
  console.log(`[pilot] node-pty: ${slot} -> build/{${placed.join(',')}}/pty.node`)
}

async function runBaseAfterPack(context) {
  const hook = base.afterPack
  if (typeof hook === 'function') {
    return hook(context)
  }
  if (typeof hook !== 'string') {
    return undefined
  }
  const loaded = require(join(__dirname, '../../../..', hook))
  const fn = typeof loaded === 'function' ? loaded : loaded.default
  return fn(context)
}

module.exports = {
  ...base,
  appId: 'dev.nsitapara.pilot',
  productName: 'Pilot',
  protocols: [{ name: 'Pilot', schemes: ['pilot'] }],
  extraMetadata: { ...base.extraMetadata, name: 'pilot', productName: 'Pilot' },
  publish: null,
  asarUnpack: [...(base.asarUnpack ?? []), 'out/packages/pilot/**'],
  mac: {
    ...base.mac,
    // Ad hoc: macOS registers only a validly signed bundle with Notification Center. build-mac.mjs reseals it.
    identity: '-',
    artifactName: 'pilot-macos-${arch}.${ext}',
    extraResources: pilotMacResources(base.mac?.extraResources)
  },
  linux: {
    ...base.linux,
    executableName: 'pilot',
    artifactName: 'pilot-linux-${arch}.${ext}',
    // Electron names the window's class after package.json's name, which extraMetadata makes `pilot`.
    desktop: { ...base.linux?.desktop, entry: { ...base.linux?.desktop?.entry, StartupWMClass: 'pilot' } },
    extraResources: pilotLinuxResources(base.linux?.extraResources)
  },
  win: { ...base.win, executableName: 'Pilot' },
  afterPack: async (context) => {
    placeLinuxPty(context)
    await runBaseAfterPack(context)
    const launchers =
      context.electronPlatformName === 'linux'
        ? [join(context.appOutDir, 'resources/bin/pilot'), join(context.appOutDir, 'resources/bin/orca-ide')]
        : [
            join(
              context.appOutDir,
              `${context.packager.appInfo.productFilename}.app`,
              'Contents/Resources/bin/pilot'
            )
          ]
    for (const launcher of launchers) {
      if (existsSync(launcher)) {
        chmodSync(launcher, 0o755)
      }
    }
  }
}
