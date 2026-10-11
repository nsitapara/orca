import { app } from 'electron'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { claudeQuotaReader } from './fields/claude-quota'
import { startPilotServices, type PilotServices } from './pilot-services'

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
  // The desktop runs automations (D2); orcad runs them only with PILOT_SCHEDULER=on.
  // A Pilot failure (e.g. its store won't open) must never stop Orca from starting.
  let services: PilotServices
  try {
    services = startPilotServices(runtime, 'main', { quota: claudeQuotaReader() })
  } catch (error) {
    console.error(
      `[pilot] couldn't start: ${error instanceof Error ? error.message : String(error)}`
    )
    return
  }
  getAppEnvironment().onWillQuit(() => services.stop())
}
