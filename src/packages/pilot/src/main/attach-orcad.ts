import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { startPilotServices, type PilotServices } from './pilot-services'

// Hook target: src/main/orcad/orcad-entry.ts (pilot-hook: orcad), before the RPC server binds.
export function attachPilotOrcad(
  runtime: OrcaRuntimeService,
  registerCleanup: (fn: () => void) => void
): void {
  // A headless host ticks only when asked (D25), so a desktop and a headless host never both tick.
  // A Pilot failure (e.g. its store won't open) must never stop orcad from serving.
  let services: PilotServices
  try {
    services = startPilotServices(runtime, 'orcad', {
      schedulerEnabled: process.env.PILOT_SCHEDULER === 'on'
    })
  } catch (error) {
    console.error(
      `[pilot] couldn't start: ${error instanceof Error ? error.message : String(error)}`
    )
    return
  }
  registerCleanup(() => services.stop())
}
