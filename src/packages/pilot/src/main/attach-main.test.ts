import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { setAppEnvironment, type AppEnvironment } from '../../../../shared/app-environment'

const m = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), quota: vi.fn(), onWillQuit: vi.fn() }))
const host = vi.hoisted(() => ({
  app: { isPackaged: false, setName: () => {}, getAppPath: () => '/repo' },
  state: { isServeMode: false }
}))
vi.mock('electron', () => ({ app: host.app }))
vi.mock('../../../../main/startup/main-process-state', () => ({ mainProcessState: host.state }))
vi.mock('./pilot-services', () => ({ startPilotServices: m.start }))
vi.mock('./fields/claude-quota', () => ({ claudeQuotaReader: () => m.quota }))

import { attachPilotMain } from './attach-main'

const runtime = {} as OrcaRuntimeService

describe('attachPilotMain', () => {
  beforeEach(() => {
    for (const fn of Object.values(m)) {
      fn.mockReset()
    }
    host.app.isPackaged = true
    host.state.isServeMode = false
    vi.stubEnv('PILOT_SCHEDULER', undefined)
    Object.defineProperty(process, 'resourcesPath', {
      configurable: true,
      value: '/Apps/Pilot.app/Contents/Resources'
    })
    setAppEnvironment({
      onWillQuit: m.onWillQuit,
      getPath: () => '/data/pilot'
    } as unknown as AppEnvironment)
  })
  afterEach(() => {
    delete (process as { resourcesPath?: string }).resourcesPath
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('starts Pilot with the Claude quota reader and stops it when the app quits', () => {
    m.start.mockReturnValue({ stop: m.stop, context: {} })
    attachPilotMain(runtime)
    expect(m.start).toHaveBeenCalledWith(runtime, 'main', {
      quotas: { claude: m.quota },
      engineEnv: { binDir: '/Apps/Pilot.app/Contents/Resources/bin', dataDir: '/data/pilot' },
      schedulerEnabled: true
    })
    m.onWillQuit.mock.calls[0][0]()
    expect(m.stop).toHaveBeenCalledTimes(1)
  })

  // Only one Pilot ticks: unset, that is the packaged desktop app; PILOT_SCHEDULER decides elsewhere.
  it.each([
    ['packaged desktop', true, false, undefined, true],
    ['packaged desktop', true, false, 'off', false],
    ['packaged desktop', true, false, 'on', true],
    ['dev', false, false, undefined, false],
    ['dev', false, false, 'off', false],
    ['dev', false, false, 'on', true],
    ['packaged serve', true, true, undefined, false],
    ['packaged serve', true, true, 'off', false],
    ['packaged serve', true, true, 'on', true],
    ['dev serve', false, true, undefined, false]
  ])(
    '%s (packaged %s, serve %s), PILOT_SCHEDULER=%s: scheduler %s',
    (_name, packaged, serve, env, on) => {
      host.app.isPackaged = packaged
      host.state.isServeMode = serve
      vi.stubEnv('PILOT_SCHEDULER', env)
      m.start.mockReturnValue({ stop: m.stop, context: {} })
      attachPilotMain(runtime)
      expect(m.start.mock.calls[0][2]).toMatchObject({ schedulerEnabled: on })
    }
  )

  it("logs a failed start and lets the app go on (Pilot's store can't stop Orca)", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.start.mockImplementation(() => {
      throw new Error('file is not a database')
    })
    expect(() => attachPilotMain(runtime)).not.toThrow()
    expect(error).toHaveBeenCalledWith("[pilot] couldn't start: file is not a database")
    expect(m.onWillQuit).not.toHaveBeenCalled()
  })

  // Serve mode installs the CLI after this hook: it must install `pilot` even when Pilot failed.
  it('sets the env defaults before starting, even when the start throws', () => {
    vi.stubEnv('ORCA_CLI_INSTALL_PATH', undefined)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    m.start.mockImplementation(() => {
      expect(process.env.ORCA_CLI_INSTALL_PATH).toBe('/usr/local/bin/pilot')
      throw new Error('boom')
    })
    attachPilotMain(runtime)
    expect(m.start).toHaveBeenCalledTimes(1)
    expect(process.env.ORCA_CLI_INSTALL_PATH).toBe('/usr/local/bin/pilot')
  })
})
