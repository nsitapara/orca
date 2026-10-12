import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../main/runtime/orca-runtime'
import { setAppEnvironment, type AppEnvironment } from '../../../../shared/app-environment'
import type { PilotStatus } from '../shared/api-types'
import type * as Live from './definitions/live'
import { STALE_START_OUTCOME } from './run/stale-starts'
import { PilotStore } from './store/store'

type Method = { name: string; handler: () => unknown }
const registry = vi.hoisted(() => [] as Method[])
vi.mock('../../../../main/runtime/rpc/methods/index', () => ({ ALL_RPC_METHODS: registry }))
const live = vi.hoisted(() => ({ fail: false }))
vi.mock('./definitions/live', async (importOriginal) => {
  const actual = await importOriginal<typeof Live>()
  return {
    ...actual,
    liveDefinitions: (...args: Parameters<typeof actual.liveDefinitions>) => {
      if (live.fail) {
        throw new Error('watch failed')
      }
      return actual.liveDefinitions(...args)
    }
  }
})

import { startPilotServices } from './pilot-services'

// Nothing touches the runtime at startup: it is only used inside ticks and polls.
const runtime = {} as OrcaRuntimeService
let userData = ''
let dir = ''
let logs: string[] = []

beforeEach(() => {
  registry.length = 0
  live.fail = false
  userData = mkdtempSync(join(tmpdir(), 'pilot-services-data-'))
  dir = mkdtempSync(join(tmpdir(), 'pilot-services-automations-'))
  writeFileSync(
    join(dir, 'ci.yaml'),
    'name: ci\nrepo: r\nschedule: "10 * * * *"\nitems: { kind: merge_request }\nsteps: [ { agent: claude, prompt: x } ]\n'
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
  it('keeps running the last valid version of a file edited into an invalid one', () => {
    const services = startPilotServices(runtime, 'main')
    writeFileSync(join(dir, 'ci.yaml'), 'name: [')
    expect(services.context.reload().definitions.map((d) => d.id)).toEqual(['ci'])
    services.stop()
  })

  it('opens the store in userData, loads the folders, and runs the scheduler when asked', () => {
    const services = startPilotServices(runtime, 'main', { schedulerEnabled: true })
    expect(existsSync(join(userData, 'pilot-automations.db'))).toBe(true)
    expect(services.context.loaded().definitions.map((d) => d.id)).toEqual(['ci'])
    expect(logs).toContain('[pilot] scheduler started: first check in 60s, then every 15s')
    expect(logs).toContain(`[pilot] attached (main): 1 automation(s) from ${dir}`)
    const status = registry.find((m) => m.name === 'pilot.status')!.handler() as PilotStatus
    expect(status).toMatchObject({
      process: 'main',
      dataPath: userData,
      automationDirs: [dir],
      missingDirs: [],
      error: null
    })
    expect(status.peopleError).toContain('people.yaml')
    services.stop()
    expect(() => services.stop()).not.toThrow()
    expect(() => services.context.store.lastRealTick('ci')).toThrow()
  })

  it('leaves the scheduler off unless asked, and sweeps stale starts only when it starts', () => {
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
    const off = startPilotServices(runtime, 'orcad')
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

  // Group 22 note: a 'running' card action left by a crash would block its card for ever.
  it('marks actions a stop left running as failed when the scheduler starts', () => {
    const seed = PilotStore.open(join(userData, 'pilot-automations.db'))
    const left = seed.actions.start({
      inboxItemId: 'in_1',
      runId: null,
      action: 'push',
      args: {},
      digest: 'd',
      phase: 'do',
      dryRun: false,
      startedAt: 1
    })
    seed.close()
    const off = startPilotServices(runtime, 'orcad')
    expect(off.context.store.actions.get(left)?.status).toBe('running')
    off.stop()
    const on = startPilotServices(runtime, 'orcad', { schedulerEnabled: true })
    expect(on.context.store.actions.get(left)?.status).toBe('failed')
    expect(logs).toContain('[pilot] store: 1 action(s) a stop interrupted marked failed')
    on.stop()
  })

  it('closes interrupted ticks and prunes old ones when Pilot starts', () => {
    const seed = PilotStore.open(join(userData, 'pilot-automations.db'))
    const stuck = seed.startTick('ci', false, 0)
    seed.close()
    const services = startPilotServices(runtime, 'main')
    expect(services.context.store.lastTick('ci')).toMatchObject({ id: stuck, status: 'failed' })
    expect(logs).toContain(
      '[pilot] store: 1 interrupted tick(s) closed, 0 tick(s) older than 30 days removed'
    )
    services.stop()
  })

  it("throws when the store can't open, yet pilot.status still answers with the reason", () => {
    writeFileSync(
      join(userData, 'pilot-automations.db'),
      'not sqlite at all, just enough text here'
    )
    expect(() => startPilotServices(runtime, 'main')).toThrow(/not a database/)
    const status = registry.find((m) => m.name === 'pilot.status')!.handler() as PilotStatus
    expect(status).toMatchObject({ process: 'main', automationDirs: [dir], peopleError: null })
    expect(status.error).toMatch(/not a database/)
    expect(logs.some((m) => m.startsWith('[pilot] attached'))).toBe(false)
  })

  it('closes the store it opened when a later step of startup fails', () => {
    live.fail = true
    const close = vi.spyOn(PilotStore.prototype, 'close')
    expect(() => startPilotServices(runtime, 'main')).toThrow('watch failed')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
