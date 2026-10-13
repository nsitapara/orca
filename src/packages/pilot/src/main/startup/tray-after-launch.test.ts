import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Drives upstream's real openMainWindow wiring (main-window-controller.ts) with every collaborator
// stubbed. `makeStatusItem` stands in for createSystemTray: new Tray, setImage and setContextMenu,
// the -[NSStatusItem setMenu:] call the hung launch was stuck in (stablyai/orca#17045).
const h = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWindow extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), { id: 7 })
    isDestroyed(): boolean {
      return false
    }
  }
  return {
    FakeWindow,
    window: new FakeWindow(),
    makeStatusItem: vi.fn(),
    state: { isQuitting: false, isServeMode: false, mainWindow: null, automations: null }
  }
})
vi.mock('electron', () => ({
  app: { name: 'Pilot', getPath: () => '/tmp', getVersion: () => '0' }
}))
vi.mock('../../../../../main/window/createMainWindow', () => ({
  createMainWindow: () => h.window,
  loadMainWindow: vi.fn()
}))
vi.mock('../../../../../main/crash-reporting/crash-breadcrumb-store', () => ({
  recordCrashBreadcrumb: vi.fn(),
  recordCoalescedCrashBreadcrumb: vi.fn()
}))
vi.mock('../../../../../main/crash-reporting/durable-crash-breadcrumb', () => ({
  recordDurableCrashBreadcrumb: vi.fn()
}))
vi.mock('../../../../../main/crash-reporting/process-gone-classification', () => ({
  shouldRecoverRendererAfterProcessGone: vi.fn()
}))
vi.mock('../../../../../main/telemetry/consent', () => ({
  resolveConsent: () => ({ effective: 'disabled' })
}))
vi.mock('../../../../../main/telemetry/client', () => ({ trackAppOpenedOnce: vi.fn() }))
vi.mock('../../../../../main/startup/windows-user-data-acl', () => ({
  ensureWindowsUserDataAclGrant: vi.fn()
}))
vi.mock('../../../../../main/startup/windows-install-dir-acl-probe', () => ({
  probeWindowsInstallDirAcl: vi.fn()
}))
vi.mock('../../../../../main/startup/windows-install-dir-acl-recovery', () => ({
  noteWindowsInstallDirAclProbePending: vi.fn(),
  startWindowsInstallDirAclRepairIfPoisoned: vi.fn()
}))
vi.mock('../../../../../main/startup/startup-diagnostics', () => ({ logStartupMilestone: vi.fn() }))
vi.mock('../../../../../main/window/main-window-visibility', () => ({
  notifyMainWindowBecameVisible: vi.fn()
}))
vi.mock('../../../../../main/tray/system-tray', () => ({ setTrayAttention: vi.fn() }))
vi.mock('../../../../../main/startup/main-window-actions', () => ({
  createSystemTrayDeferred: () => h.makeStatusItem,
  showRendererRecoveryPrompt: vi.fn()
}))
vi.mock('../../../../../main/startup/main-window-core-services', () => ({
  attachMainWindowCoreServices: vi.fn()
}))
vi.mock('../../../../../main/startup/main-window-agent-status', () => ({
  clearMainWindowAgentStatusListeners: vi.fn(),
  installMainWindowAgentStatusListeners: vi.fn()
}))
vi.mock('../../../../../main/startup/main-process-state', () => ({ mainProcessState: h.state }))
vi.mock('../../../../../main/startup/main-window-lifecycle-flags', () => ({
  clearExpectedRendererReload: vi.fn(),
  markExpectedRendererReload: vi.fn(),
  markRecoveryReloadInFlight: vi.fn(),
  getExpectedTeardownScope: vi.fn(),
  recordProcessGoneCrash: vi.fn()
}))
vi.mock('../../../../../main/startup/gpu-lifecycle', () => ({
  presentGpuFallbackRecoveredLaunchPrompt: vi.fn()
}))
vi.mock('../../../../../main/startup/branch-rename-hook', () => ({
  maybeAutoRenameBranchOnFirstWorkFromHook: vi.fn()
}))
vi.mock('../../../../../main/startup/synthetic-title-runtime', () => ({
  resumeSyntheticTitleSpinnerTimer: vi.fn(),
  stopSyntheticTitleSpinnerTimer: vi.fn()
}))
vi.mock('../../../../../main/startup/main-window-service-readiness', () => ({
  requireMainWindowServices: () => ({
    store: { getSettings: () => ({}) },
    keybindings: { getOverrides: () => ({}) }
  })
}))
vi.mock('../../../../../main/window/renderer-launch-failure-probe', () => ({
  recordRendererLaunchFailureProbe: vi.fn()
}))

import { openMainWindow } from '../../../../../main/startup/main-window-controller'
import { setActiveSink } from '../../../../../main/observability/tracer'
import { beginPilotStartup } from './pilot-startup'
import { TRAY_SETTLE_MS } from './tray-after-launch'

const realPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

describe("openMainWindow's tray (upstream wiring + pilot-hook tray-after-launch)", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'Date']
    })
    h.window = new h.FakeWindow()
    h.makeStatusItem.mockReset()
  })
  afterEach(() => {
    setActiveSink(null)
    setPlatform(realPlatform)
    vi.useRealTimers()
  })

  // RED before the hook: upstream makes the status item on the setImmediate after ready-to-show,
  // the tick the window is revealed on, which is where the 2026-10-13 launch hung for good.
  it.each([
    ['darwin', 0],
    ['win32', 1]
  ] as const)(
    '%s: status items made on the tick after ready-to-show: %i',
    (platform, onRevealTick) => {
      setPlatform(platform)
      openMainWindow()
      h.window.emit('ready-to-show')
      vi.advanceTimersByTime(1)
      expect(h.makeStatusItem).toHaveBeenCalledTimes(onRevealTick)
    }
  )

  it('darwin: makes the status item once, TRAY_SETTLE_MS after ready-to-show', () => {
    setPlatform('darwin')
    openMainWindow()
    h.window.emit('ready-to-show')
    vi.advanceTimersByTime(TRAY_SETTLE_MS - 1)
    expect(h.makeStatusItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(h.makeStatusItem).toHaveBeenCalledTimes(1)
    // Upstream's 12s fallback call reaches the same deferred creator and adds nothing.
    vi.advanceTimersByTime(60_000)
    expect(h.makeStatusItem).toHaveBeenCalledTimes(1)
  })

  it("darwin: a window that never reaches ready-to-show still gets its tray after upstream's fallback", () => {
    setPlatform('darwin')
    openMainWindow()
    vi.advanceTimersByTime(12_000)
    expect(h.makeStatusItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(TRAY_SETTLE_MS)
    expect(h.makeStatusItem).toHaveBeenCalledTimes(1)
  })

  it('darwin: traces every startup phase through to complete, the tray last', () => {
    setPlatform('darwin')
    const events: string[] = []
    setActiveSink({
      push: (record) => {
        const attributes = Object(Object(record).attributes)
        events.push(`${attributes.event} ${attributes.phase ?? ''}`.trim())
      },
      flush: () => {},
      close: () => {}
    })
    // As attachPilotMain does it.
    const startup = beginPilotStartup('desktop', false)
    startup.run('services', () => {})
    startup.begin('launch')
    openMainWindow()
    h.window.emit('ready-to-show')
    h.window.webContents.emit('did-finish-load')
    vi.advanceTimersByTime(TRAY_SETTLE_MS)
    expect(events).toEqual([
      'begin services',
      'end services',
      'begin launch',
      'end launch',
      'begin window',
      'begin renderer',
      'end window',
      'end renderer',
      'begin tray',
      'end tray',
      'complete'
    ])
  })
})
