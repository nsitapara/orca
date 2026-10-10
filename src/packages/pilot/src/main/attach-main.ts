import { app } from 'electron'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { startPilotServices } from './pilot-services'

// Hook target: src/main/startup/main-process-ready-runtime.ts (pilot-hook: main). Runs once in desktop
// and serve mode, before the RPC server and dispatcher are built.
function pilotAppName(): string {
  if (app.isPackaged) {
    return 'Pilot'
  }
  return 'Pilot Dev'
}

export function attachPilotMain(runtime: OrcaRuntimeService): void {
  // Why: Orca's ready step calls app.setName('Orca'). userData is already captured, so renaming here
  // changes menus and dialogs only.
  // Upstream startup tests mock `app` without setName (R9), so tolerate its absence.
  if (typeof app.setName === 'function') {
    app.setName(pilotAppName())
  }
  const services = startPilotServices(runtime, 'main')
  getAppEnvironment().onWillQuit(() => services.stop())
}
