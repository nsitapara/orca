import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { applyPilotEnvDefaults, pilotSchedulerEnabled, pilotSchedulerMode } from './env'
import { startPilotServices, type PilotServices } from './pilot-services'

// Hook target: src/main/orcad/orcad-entry.ts (pilot-hook: orcad), before the RPC server binds.
export function attachPilotOrcad(
  runtime: OrcaRuntimeService,
  registerCleanup: (fn: () => void) => void
): void {
  // First and outside the try, so the env defaults hold even when Pilot's services fail to start.
  applyPilotEnvDefaults()
  // orcad ticks only with PILOT_SCHEDULER=on (pilotSchedulerEnabled): by default the packaged desktop
  // app is the one Pilot that ticks, so two hosts never start agents for the same automations.
  // A Pilot failure (e.g. its store won't open) must never stop orcad from serving.
  let services: PilotServices
  try {
    services = startPilotServices(runtime, 'orcad', {
      schedulerEnabled: pilotSchedulerEnabled('orcad'),
      pinnedOnly: pilotSchedulerMode('orcad') === 'pinned'
    })
  } catch (error) {
    console.error(
      `[pilot] couldn't start: ${error instanceof Error ? error.message : String(error)}`
    )
    return
  }
  registerCleanup(() => services.stop())
}
