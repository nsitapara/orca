import { app } from 'electron'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { mainProcessState } from '../../../../main/startup/main-process-state'
import { getAppEnvironment } from '../../../../shared/app-environment'
import { applyPilotEnvDefaults, pilotSchedulerEnabled, type PilotHostKind } from './env'
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

// Upstream's preflight sets isServeMode from `--serve` (main-process-preflight.ts) before the app is
// ready, so it is settled by the time this hook runs. A packaged serve is still a serve.
function hostKind(): PilotHostKind {
  if (mainProcessState.isServeMode) {
    return 'serve'
  }
  if (!app.isPackaged) {
    return 'dev'
  }
  return 'desktop'
}

export function attachPilotMain(runtime: OrcaRuntimeService): void {
  // First and outside the try: serve mode's CLI install (main-process-runtime-launch.ts) reads
  // ORCA_CLI_INSTALL_PATH after this hook, even when Pilot's services fail to start.
  applyPilotEnvDefaults()
  // Why: Orca's ready step calls app.setName('Orca'). userData is already captured, so renaming here
  // changes menus and dialogs only.
  // Upstream startup tests mock `app` without setName (R9), so tolerate its absence.
  if (typeof app.setName === 'function') {
    app.setName(pilotAppName())
  }
  // Only the packaged desktop app ticks unless PILOT_SCHEDULER says otherwise (pilotSchedulerEnabled).
  // A Pilot failure (e.g. its store won't open) must never stop Orca from starting.
  let services: PilotServices
  try {
    services = startPilotServices(runtime, 'main', {
      quota: claudeQuotaReader(),
      schedulerEnabled: pilotSchedulerEnabled(hostKind())
    })
  } catch (error) {
    console.error(
      `[pilot] couldn't start: ${error instanceof Error ? error.message : String(error)}`
    )
    return
  }
  getAppEnvironment().onWillQuit(() => services.stop())
}
