import { app } from 'electron'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { mainProcessState } from '../../../../main/startup/main-process-state'
import { getAppEnvironment } from '../../../../shared/app-environment'
import {
  applyPilotEnvDefaults,
  pilotResourcesDir,
  pilotSchedulerEnabled,
  pilotSchedulerMode,
  type PilotHostKind
} from './env'
import { pilotBinDir } from './engine-env'
import { claudeQuotaReader } from './fields/claude-quota'
import { codexQuotaReader } from './fields/codex-quota'
import { startPilotServices, type PilotServices } from './pilot-services'
import { loginPath } from './startup/login-path'
import { attachVaultNotesOnRemoval, vaultNotesOnRemovalDeps } from './vault/notes-on-removal'
import { beginPilotStartup } from './startup/pilot-startup'

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
  const kind = hostKind()
  // Trace markers for each startup phase, and a watchdog thread that reports one stuck for 30s.
  const startup = beginPilotStartup(kind, app.isPackaged)
  // Only the packaged desktop app ticks unless PILOT_SCHEDULER says otherwise (pilotSchedulerEnabled).
  // A Pilot failure (e.g. its store won't open) must never stop Orca from starting.
  let services: PilotServices
  try {
    const where = {
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath()
    }
    services = startup.run('services', () =>
      startPilotServices(runtime, 'main', {
        quotas: { claude: claudeQuotaReader(), codex: codexQuotaReader() },
        engineEnv: {
          binDir: pilotBinDir(where),
          dataDir: getAppEnvironment().getPath('userData')
        },
        resourcesDir: pilotResourcesDir(where),
        schedulerEnabled: pilotSchedulerEnabled(kind),
        pinnedOnly: pilotSchedulerMode(kind) === 'pinned'
      })
    )
    // A removed worktree's notes folder goes to the vault's Archive (pilot-hook: vault-notes-on-removal).
    attachVaultNotesOnRemoval(vaultNotesOnRemovalDeps(pilotBinDir(where)))
  } catch (error) {
    console.error(
      `[pilot] couldn't start: ${error instanceof Error ? error.message : String(error)}`
    )
    return
  } finally {
    // Ended when the main window is created (pilot-hook: tray-after-launch); serve has no such phase.
    startup.begin('launch')
  }
  // Upstream probes the login shell's PATH only in a packaged app outside Windows (main-process-preflight.ts).
  if (app.isPackaged && process.platform !== 'win32') {
    services.context.scheduler.holdUntil(loginPath())
  }
  getAppEnvironment().onWillQuit(() => services.stop())
}
