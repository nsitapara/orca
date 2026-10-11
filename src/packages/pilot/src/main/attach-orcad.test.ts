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
    [undefined, false],
    ['on', true],
    ['off', false],
    ['1', false],
    ['ON', false]
  ])('PILOT_SCHEDULER=%s runs the scheduler: %s, and stops Pilot on cleanup', (value, enabled) => {
    vi.stubEnv('PILOT_SCHEDULER', value)
    const cleanups: (() => void)[] = []
    attachPilotOrcad(runtime, (fn) => cleanups.push(fn))
    expect(services.start).toHaveBeenCalledWith(runtime, 'orcad', { schedulerEnabled: enabled })
    expect(cleanups).toHaveLength(1)
    cleanups[0]()
    expect(services.stop).toHaveBeenCalledTimes(1)
  })

  it('only attach-main imports the Claude quota reader, so orcad never loads it (R3)', () => {
    const root = join(import.meta.dirname, '..')
    const importers = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
      .filter((f) => /from '[^']*\/claude-quota'/.test(readFileSync(join(root, f), 'utf8')))
    expect(importers).toEqual(['main/attach-main.ts'])
  })
})
