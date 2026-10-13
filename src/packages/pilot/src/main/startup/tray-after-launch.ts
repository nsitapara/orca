import type { BrowserWindow } from 'electron'
import { logStartupMilestone } from '../../../../../main/startup/startup-diagnostics'
import { pilotStartup } from './pilot-startup'

// Why: upstream makes the macOS status item on the tick after ready-to-show, as the window is
// revealed. A status-item update then can deadlock the main thread for good inside FrontBoard
// (-[NSStatusItem setMenu:] -> FBSScene performAsyncAndWait): stablyai/orca#17045, and Pilot's
// launch of 2026-10-13. Pilot makes it once the launch has settled.
export const TRAY_SETTLE_MS = 10_000

// Upstream's createSystemTrayDeferred: a once-only creator that checks quit, window and setting.
type TrayCreatorFactory = (window: BrowserWindow, onCreated: () => void) => () => void

// Hook target: src/main/startup/main-window-controller.ts (pilot-hook: tray-after-launch). Builds
// upstream's creator with its 'tray-created' milestone, and ends the startup phases this window settles.
export function deferTrayPastLaunch(
  window: BrowserWindow,
  createTrayCreator: TrayCreatorFactory
): () => void {
  const createTray = createTrayCreator(window, () => logStartupMilestone('tray-created'))
  const startup = pilotStartup()
  if (startup) {
    startup.end('launch')
    startup.begin('window')
    startup.begin('renderer')
    window.once('ready-to-show', () => startup.end('window'))
    window.webContents.once('did-finish-load', () => startup.end('renderer'))
  }
  const makeTray = (): void => {
    if (startup) {
      startup.run('tray', createTray)
    } else {
      createTray()
    }
  }
  if (process.platform !== 'darwin') {
    return makeTray
  }
  let scheduled = false
  return () => {
    if (scheduled) {
      return
    }
    scheduled = true
    startup?.begin('tray')
    const timer = setTimeout(makeTray, TRAY_SETTLE_MS)
    timer.unref()
    // A closed window gets no tray (upstream's creator would refuse it); a reopened one schedules its own.
    window.once('closed', () => {
      clearTimeout(timer)
      startup?.end('tray')
    })
  }
}
