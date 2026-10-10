// Hook target: src/main/updater/updater-setup.ts (pilot-hook: updater). Upstream's updater has no off
// switch and hardcodes stablyai/orca's feed, so a packaged Pilot would offer Orca releases.
export function isPilotUpdaterDisabled(
  opts: { env?: NodeJS.ProcessEnv; inElectron?: boolean } = {}
): boolean {
  const env = opts.env ?? process.env
  const inElectron = opts.inElectron ?? Boolean(process.versions.electron)
  // Why: upstream's updater tests run under plain Node with a mocked `app`; they keep exercising the real updater.
  return inElectron && env.PILOT_ENABLE_UPDATER !== '1'
}
