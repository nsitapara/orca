// Hook target: src/main/startup/main-process-runtime-launch.ts (pilot-hook: runtime-ws-port). Real Orca
// owns 6768; Pilot defaults to 6868 so both can run and loopback clients reach the right app.
export function pilotRuntimeWsOptions(
  opts: { env?: NodeJS.ProcessEnv; inElectron?: boolean } = {}
): { wsPort?: number } {
  const env = opts.env ?? process.env
  const inElectron = opts.inElectron ?? Boolean(process.versions.electron)
  // Why: upstream startup tests run under plain Node with a mocked `electron`; they keep upstream defaults.
  if (!inElectron) {
    return {}
  }
  const raw = env.PILOT_WS_PORT ?? '6868'
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.warn(`[pilot] ignoring invalid PILOT_WS_PORT=${raw}`)
    return {}
  }
  return { wsPort: port }
}
