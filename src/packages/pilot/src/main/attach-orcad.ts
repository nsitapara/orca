import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { pilotSchedulerEnabled } from './env'
import { startPilotServices, type PilotServices } from './pilot-services'

// Hook target: src/main/orcad/orcad-entry.ts (pilot-hook: orcad), before the RPC server binds.
export function attachPilotOrcad(
  runtime: OrcaRuntimeService,
  registerCleanup: (fn: () => void) => void
): void {
  // orcad ticks only with PILOT_SCHEDULER=on (pilotSchedulerEnabled): by default the packaged desktop
  // app is the one Pilot that ticks, so two hosts never start agents for the same automations.
  // A Pilot failure (e.g. its store won't open) must never stop orcad from serving.
  let services: PilotServices
  try {
    services = startPilotServices(runtime, 'orcad', {
      schedulerEnabled: pilotSchedulerEnabled('orcad')
    })
  } catch (error) {
    console.error(
      `[pilot] couldn't start: ${error instanceof Error ? error.message : String(error)}`
    )
    return
  }
  registerCleanup(() => services.stop())
}
