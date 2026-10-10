import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { startPilotServices } from './pilot-services'

// Hook target: src/main/startup/main-process-ready-runtime.ts (pilot-hook: main). Runs once in desktop
// and serve mode, before the RPC server and dispatcher are built.
export function attachPilotMain(runtime: OrcaRuntimeService): void {
  const services = startPilotServices(runtime, 'main')
  getAppEnvironment().onWillQuit(() => services.stop())
}
