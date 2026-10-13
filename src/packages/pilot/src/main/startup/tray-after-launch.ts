import type { BrowserWindow } from 'electron'
import { pilotStartup } from './pilot-startup'

// Why: upstream makes the macOS status item on the tick after ready-to-show, as the window is
// revealed. A status-item update then can deadlock the main thread for good inside FrontBoard
// (-[NSStatusItem setMenu:] -> FBSScene performAsyncAndWait): stablyai/orca#17045, and Pilot's
// launch of 2026-10-13. Pilot makes it once the launch has settled.
export const TRAY_SETTLE_MS = 10_000

// Hook target: src/main/startup/main-window-controller.ts (pilot-hook: tray-after-launch). Wraps
// upstream's once-only tray creator, and ends the startup phases this window settles.
export function deferTrayPastLaunch(window: BrowserWindow, createTray: () => void): () => void {
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
    setTimeout(makeTray, TRAY_SETTLE_MS).unref()
  }
}
