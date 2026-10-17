// Pilot's packaged build (D23). Requires Orca's config and overrides only identity, launchers and the
// update feed. Orca's file is never edited. Relative paths resolve against the repo root.
const { chmodSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const base = require('../../../../config/electron-builder.config.cjs')

const PILOT_BIN = 'src/packages/pilot/build/bin'
// Pilot's own static files (the token report's page), read from Contents/Resources/pilot (env.ts pilotResourcesDir).
const PILOT_RESOURCES = 'src/packages/pilot/resources'
const ORCA_LAUNCHER = 'resources/darwin/bin/orca'
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
    artifactName: 'pilot-macos-${arch}.${ext}',
    extraResources: pilotMacResources(base.mac?.extraResources)
  },
  linux: { ...base.linux, executableName: 'pilot', artifactName: 'pilot-linux-${arch}.${ext}' },
  win: { ...base.win, executableName: 'Pilot' },
  afterPack: async (context) => {
    await runBaseAfterPack(context)
    const pilot = join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents/Resources/bin/pilot'
    )
    if (existsSync(pilot)) {
      chmodSync(pilot, 0o755)
    }
  }
}
