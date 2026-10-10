import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { startPilotServices } from './pilot-services'

// Hook target: src/main/orcad/orcad-entry.ts (pilot-hook: orcad), before the RPC server binds.
export function attachPilotOrcad(
  runtime: OrcaRuntimeService,
  registerCleanup: (fn: () => void) => void
): void {
  const services = startPilotServices(runtime, 'orcad')
  registerCleanup(() => services.stop())
}
