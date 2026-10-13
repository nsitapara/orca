import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Drives upstream's real openMainWindow and createSystemTrayDeferred (its quit, destroyed-window and
// menu-bar-setting checks) with the tray module stubbed: a status item is made when
// setMacMenuBarIconVisible(true) or createSystemTray runs. On macOS that is new Tray, setImage and
// setContextMenu, the -[NSStatusItem setMenu:] the hung launch was stuck in (stablyai/orca#17045).
const h = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  class FakeWindow extends EventEmitter {
    destroyed = false
    webContents = Object.assign(new EventEmitter(), { id: 7 })
    isDestroyed(): boolean {
      return this.destroyed
    }
  }
  const settings = { showMenuBarIcon: true }
  return {
    FakeWindow,
    window: new FakeWindow(),
    settings,
    milestone: vi.fn(),
    tray: {
      setMacMenuBarIconVisible: vi.fn((visible: boolean) => (visible ? {} : null)),
      createSystemTray: vi.fn(() => ({})),
      setTrayAttention: vi.fn()
    },
    state: {
      isQuitting: false,
      isServeMode: false,
      mainWindow: null,
      automations: null,
      devInstanceIdentity: null,
      store: { getSettings: () => settings }
    }
  }
})
vi.mock('electron', () => ({
  app: { name: 'Pilot', getPath: () => '/tmp', getVersion: () => '0' },
  clipboard: {},
  dialog: {}
}))
vi.mock('../../../../../main/tray/system-tray', () => h.tray)
vi.mock('../../../../../main/startup/main-process-state', () => ({ mainProcessState: h.state }))
vi.mock('../../../../../main/startup/startup-diagnostics', () => ({
  logStartupMilestone: h.milestone
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
  startWindowsInstallDirAclRepairIfPoisoned: vi.fn(),
  describeInstallDirAclPoison: vi.fn(),
  isBlockingInstallDirAclRepairInFlight: () => false
}))
vi.mock('../../../../../main/window/main-window-visibility', () => ({
  notifyMainWindowBecameVisible: vi.fn()
}))
vi.mock('../../../../../main/startup/main-window-core-services', () => ({
  attachMainWindowCoreServices: vi.fn()
}))
vi.mock('../../../../../main/startup/main-window-agent-status', () => ({
  clearMainWindowAgentStatusListeners: vi.fn(),
  installMainWindowAgentStatusListeners: vi.fn()
}))
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
  recordRendererLaunchFailureProbe: vi.fn(),
  probeRendererLaunchCapacity: vi.fn()
}))
vi.mock('../../../../../main/updater', () => ({
  checkForUpdatesFromMenu: vi.fn(),
  isQuittingForUpdate: () => false
}))
vi.mock('../../../../../main/window/attach-main-window-services', () => ({
  ensureAutoUpdaterConfigured: vi.fn()
}))
vi.mock('../../../../../main/window/focus-existing-window', () => ({
  focusExistingMainWindow: vi.fn(),
  safelyRevealWindow: vi.fn()
}))
vi.mock('../../../../../main/window/dashboard-popout-window', () => ({
  getDashboardPopoutWindow: () => null
}))
vi.mock('../../../../../main/window/user-quit-window-close', () => ({
  markUserQuitWindowClose: vi.fn()
}))
vi.mock('../../../../../main/window/renderer-recovery-prompt', () => ({
  presentRendererRecoveryPrompt: vi.fn()
}))

import { openMainWindow } from '../../../../../main/startup/main-window-controller'
import { setActiveSink } from '../../../../../main/observability/tracer'
import { beginPilotStartup } from './pilot-startup'
import { TRAY_SETTLE_MS } from './tray-after-launch'

const realPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { configurable: true, value: platform })
}

function statusItemsMade(): number {
  const shown = h.tray.setMacMenuBarIconVisible.mock.calls.filter(([visible]) => visible)
  return shown.length + h.tray.createSystemTray.mock.calls.length
}

// openMainWindow, then ready-to-show and upstream's setImmediate(createTray) after it.
function openAndReveal(): void {
  openMainWindow()
  h.window.emit('ready-to-show')
  vi.advanceTimersByTime(1)
}

describe("openMainWindow's tray (upstream wiring + pilot-hook tray-after-launch)", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'Date']
    })
    h.window = new h.FakeWindow()
    h.state.isQuitting = false
    h.settings.showMenuBarIcon = true
    h.milestone.mockClear()
    h.tray.setMacMenuBarIconVisible.mockClear()
    h.tray.createSystemTray.mockClear()
  })
  afterEach(() => {
    setActiveSink(null)
    setPlatform(realPlatform)
    vi.useRealTimers()
  })

  // RED before the hook: upstream makes the status item on the setImmediate after ready-to-show,
  // the tick the window is revealed on, which is where the 2026-10-13 launch hung for good.
  // Elsewhere the hook returns the creator as is: it runs on that tick and schedules nothing.
  it.each([
    ['darwin', 0, 2],
    ['win32', 1, 1],
    ['linux', 1, 1]
  ] as const)(
    '%s: status items made on the tick after ready-to-show: %i; timers pending: %i',
    (platform, made, pendingTimers) => {
      setPlatform(platform)
      openAndReveal()
      expect(statusItemsMade()).toBe(made)
      // Upstream's 12s fallback, plus Pilot's settle timer on macOS only.
      expect(vi.getTimerCount()).toBe(pendingTimers)
    }
  )

  it('darwin: makes the status item once, TRAY_SETTLE_MS after ready-to-show', () => {
    setPlatform('darwin')
    openAndReveal()
    vi.advanceTimersByTime(TRAY_SETTLE_MS - 2)
    expect(statusItemsMade()).toBe(0)
    expect(h.milestone).not.toHaveBeenCalledWith('tray-created')
    vi.advanceTimersByTime(1)
    expect(statusItemsMade()).toBe(1)
    expect(h.milestone).toHaveBeenCalledWith('tray-created')
    // Upstream's 12s fallback call reaches the same deferred creator and adds nothing.
    vi.advanceTimersByTime(60_000)
    expect(statusItemsMade()).toBe(1)
  })

  it("darwin: a window that never reaches ready-to-show still gets its tray after upstream's fallback", () => {
    setPlatform('darwin')
    openMainWindow()
    vi.advanceTimersByTime(12_000)
    expect(statusItemsMade()).toBe(0)
    vi.advanceTimersByTime(TRAY_SETTLE_MS)
    expect(statusItemsMade()).toBe(1)
  })

  // Upstream's creator checks these when it runs, which is now when the settle timer fires.
  it.each([
    ['the app is quitting', () => (h.state.isQuitting = true)],
    ['the window was destroyed', () => (h.window.destroyed = true)],
    ['"Show menu bar icon" is off', () => (h.settings.showMenuBarIcon = false)]
  ])('darwin: no status item when, before the timer fires, %s', (_name, change) => {
    setPlatform('darwin')
    openAndReveal()
    change()
    vi.advanceTimersByTime(60_000)
    expect(statusItemsMade()).toBe(0)
  })

  // RED before the closed listener: the settle timer outlived the window it was for.
  it('darwin: closing the window clears its settle timer', () => {
    setPlatform('darwin')
    openAndReveal()
    h.window.emit('closed')
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(60_000)
    expect(statusItemsMade()).toBe(0)
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
    vi.advanceTimersByTime(TRAY_SETTLE_MS + 1)
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
