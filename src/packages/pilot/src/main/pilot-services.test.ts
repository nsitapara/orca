import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { setAppEnvironment, type AppEnvironment } from '../../../../shared/app-environment'
import type { PilotStatus } from '../shared/api-types'
import { STALE_START_OUTCOME } from './run/stale-starts'
import { PilotStore } from './store/store'

type Method = { name: string; handler: () => unknown }
const registry = vi.hoisted(() => [] as Method[])
vi.mock('../../../../main/runtime/rpc/methods/index', () => ({ ALL_RPC_METHODS: registry }))

import { startPilotServices } from './pilot-services'

// Nothing touches the runtime at startup: it is only used inside ticks and polls.
const runtime = {} as OrcaRuntimeService
let userData = ''
let dir = ''
let logs: string[] = []

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'pilot-services-data-'))
  dir = mkdtempSync(join(tmpdir(), 'pilot-services-automations-'))
  writeFileSync(
    join(dir, 'ci.yaml'),
    'name: ci\nrepo: r\nschedule: "10 * * * *"\nsteps: [ { agent: claude, prompt: x } ]\n'
  )
  writeFileSync(join(dir, 'people.yaml'), 'people: [\n')
  setAppEnvironment({ getPath: () => userData } as unknown as AppEnvironment)
  vi.stubEnv('PILOT_AUTOMATION_DIRS', dir)
  logs = []
  vi.spyOn(console, 'log').mockImplementation((m: string) => void logs.push(m))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('startPilotServices', () => {
  it('opens the store in userData, loads the folders, and runs the scheduler in main by default', () => {
    const services = startPilotServices(runtime, 'main')
    expect(existsSync(join(userData, 'pilot-automations.db'))).toBe(true)
    expect(services.context.loaded().definitions.map((d) => d.id)).toEqual(['ci'])
    expect(logs).toContain('[pilot] scheduler started: first check in 60s, then every 15s')
    expect(logs).toContain(`[pilot] attached (main): 1 automation(s) from ${dir}`)
    const status = registry.find((m) => m.name === 'pilot.status')!.handler() as PilotStatus
    expect(status).toMatchObject({ process: 'main', automationDirs: [dir], missingDirs: [] })
    expect(status.peopleError).toContain('people.yaml')
    services.stop()
    expect(() => services.stop()).not.toThrow()
    expect(() => services.context.store.lastRealTick('ci')).toThrow()
  })

  it('leaves the scheduler off when told to, and sweeps stale starts only when it starts', () => {
    const seed = PilotStore.open(join(userData, 'pilot-automations.db'))
    seed.runs.create({
      id: 'run-1',
      automationId: 'ci',
      tickId: null,
      itemKey: '!1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 0
    })
    seed.runs.createStep({
      runId: 'run-1',
      idx: 0,
      name: 's',
      agent: 'claude',
      skill: null,
      startedAt: 0
    })
    seed.close()
    const off = startPilotServices(runtime, 'orcad', { schedulerEnabled: false })
    expect(logs).toContain('[pilot] scheduler off in orcad (PILOT_SCHEDULER=on runs it here)')
    expect(logs.some((m) => m.startsWith('[pilot] scheduler started'))).toBe(false)
    expect(off.context.store.runs.get('run-1')?.status).toBe('running')
    off.stop()
    const on = startPilotServices(runtime, 'orcad', { schedulerEnabled: true })
    expect(on.context.store.runs.get('run-1')).toMatchObject({
      status: 'failed',
      outcome: STALE_START_OUTCOME
    })
    on.stop()
  })
})
