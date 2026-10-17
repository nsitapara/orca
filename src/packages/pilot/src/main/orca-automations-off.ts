import type { AutomationService } from '../../../../main/automations/service'
import type { Store } from '../../../../main/persistence'

// Hook target: src/main/startup/main-process-automations.ts (pilot-hook: orca-automations-off).
// Spec hook 1: Pilot runs the YAML automations; Orca's own scheduler doesn't run inside Pilot.
export const ORCA_AUTOMATIONS_OFF =
  "Orca's own automations are off in Pilot. Pilot runs the YAML automations (pilot automations list-yaml)."

type Opts = { inElectron?: boolean; log?: (message: string) => void }

// Always off inside Electron: there is no switch back on, since the way back to Orca was retired (2026-10-15).
export function isOrcaAutomationsOff(opts: Opts = {}): boolean {
  // Why: upstream's startup and automation tests run under plain Node; they keep the real service.
  return opts.inElectron ?? Boolean(process.versions.electron)
}

function enabledCount(store: Pick<Store, 'listAutomations'>): number | null {
  try {
    return store.listAutomations().filter((a) => a.enabled).length
  } catch {
    return null
  }
}

function offLine(count: number | null): string {
  if (!count) {
    return "[pilot] Orca's automation engine is off in Pilot"
  }
  return `[pilot] Orca's automation engine is off in Pilot: ${count} enabled Orca automation(s) won't run here`
}

// The service is still built (the window's IPC takes it), then stopped with Orca's own stop(): every
// due-run pass returns at once while it is stopped, including the one renderer-ready starts. start()
// and runNow() are replaced so nothing restarts it or runs an Orca-style job by hand.
export function keepOrcaAutomationsOff(
  service: Pick<AutomationService, 'start' | 'stop' | 'runNow'>,
  store: Pick<Store, 'listAutomations'>,
  opts: Opts = {}
): void {
  if (!isOrcaAutomationsOff(opts)) {
    return
  }
  service.stop()
  service.start = () => {}
  service.runNow = async () => {
    throw new Error(ORCA_AUTOMATIONS_OFF)
  }
  const log = opts.log ?? ((message: string) => console.log(message))
  log(offLine(enabledCount(store)))
}
