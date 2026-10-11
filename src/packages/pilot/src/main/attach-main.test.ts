import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { setAppEnvironment, type AppEnvironment } from '../../../../shared/app-environment'

const m = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), quota: vi.fn(), onWillQuit: vi.fn() }))
vi.mock('electron', () => ({ app: { isPackaged: false, setName: vi.fn() } }))
vi.mock('./pilot-services', () => ({ startPilotServices: m.start }))
vi.mock('./fields/claude-quota', () => ({ claudeQuotaReader: () => m.quota }))

import { attachPilotMain } from './attach-main'

const runtime = {} as OrcaRuntimeService

describe('attachPilotMain', () => {
  beforeEach(() => {
    for (const fn of Object.values(m)) {
      fn.mockReset()
    }
    setAppEnvironment({ onWillQuit: m.onWillQuit } as unknown as AppEnvironment)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts Pilot with the Claude quota reader and stops it when the app quits', () => {
    m.start.mockReturnValue({ stop: m.stop, context: {} })
    attachPilotMain(runtime)
    expect(m.start).toHaveBeenCalledWith(runtime, 'main', { quota: m.quota })
    m.onWillQuit.mock.calls[0][0]()
    expect(m.stop).toHaveBeenCalledTimes(1)
  })

  it("logs a failed start and lets the app go on (Pilot's store can't stop Orca)", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    m.start.mockImplementation(() => {
      throw new Error('file is not a database')
    })
    expect(() => attachPilotMain(runtime)).not.toThrow()
    expect(error).toHaveBeenCalledWith("[pilot] couldn't start: file is not a database")
    expect(m.onWillQuit).not.toHaveBeenCalled()
  })
})
