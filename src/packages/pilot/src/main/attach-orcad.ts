import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { startPilotServices } from './pilot-services'

// Hook target: src/main/orcad/orcad-entry.ts (pilot-hook: orcad), before the RPC server binds.
export function attachPilotOrcad(
  runtime: OrcaRuntimeService,
  registerCleanup: (fn: () => void) => void
): void {
  // A headless host ticks only when asked (D25), so a desktop and a headless host never both tick.
  const services = startPilotServices(runtime, 'orcad', {
    schedulerEnabled: process.env.PILOT_SCHEDULER === 'on'
  })
  registerCleanup(() => services.stop())
}
