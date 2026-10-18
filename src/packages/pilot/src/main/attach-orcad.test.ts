import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'

const services = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }))
vi.mock('./pilot-services', () => ({ startPilotServices: services.start }))

import { attachPilotOrcad } from './attach-orcad'

const runtime = {} as OrcaRuntimeService

describe('attachPilotOrcad', () => {
  beforeEach(() => {
    services.start.mockReset().mockReturnValue({ stop: services.stop, context: {} })
    services.stop.mockReset()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // A desktop and a headless host must never both tick, so orcad ticks only when asked to.
  it.each([
    [undefined, false, false],
    ['on', true, false],
    ['pinned', true, true],
    ['off', false, false],
    ['1', false, false],
    ['ON', false, false]
  ])(
    'PILOT_SCHEDULER=%s runs the scheduler: %s (pinned only: %s), and stops Pilot on cleanup',
    (value, enabled, pinnedOnly) => {
      vi.stubEnv('PILOT_SCHEDULER', value)
      const cleanups: (() => void)[] = []
      attachPilotOrcad(runtime, (fn) => cleanups.push(fn))
      expect(services.start).toHaveBeenCalledWith(runtime, 'orcad', {
        schedulerEnabled: enabled,
        pinnedOnly
      })
      expect(cleanups).toHaveLength(1)
      cleanups[0]()
      expect(services.stop).toHaveBeenCalledTimes(1)
    }
  )

  it("logs a failed start and lets orcad go on (Pilot's store can't stop the host)", () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    services.start.mockImplementation(() => {
      throw new Error('SQLITE_CANTOPEN')
    })
    const cleanups: (() => void)[] = []
    expect(() => attachPilotOrcad(runtime, (fn) => cleanups.push(fn))).not.toThrow()
    expect(error).toHaveBeenCalledWith("[pilot] couldn't start: SQLITE_CANTOPEN")
    expect(cleanups).toEqual([])
    error.mockRestore()
  })

  it('sets the env defaults before starting, even when the start throws', () => {
    vi.stubEnv('ORCA_CLI_INSTALL_PATH', undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    services.start.mockImplementation(() => {
      expect(process.env.ORCA_CLI_INSTALL_PATH).toBe('/usr/local/bin/pilot')
      throw new Error('boom')
    })
    attachPilotOrcad(runtime, () => {})
    expect(services.start).toHaveBeenCalledTimes(1)
    expect(process.env.ORCA_CLI_INSTALL_PATH).toBe('/usr/local/bin/pilot')
    error.mockRestore()
  })

  it('only attach-main imports the Claude quota reader, so orcad never loads it (R3)', () => {
    const root = join(import.meta.dirname, '..')
    const importers = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /from '[^']*\/claude-quota'/.test(readFileSync(join(root, f), 'utf8')))
    expect(importers).toEqual(['main/attach-main.ts'])
  })
})
