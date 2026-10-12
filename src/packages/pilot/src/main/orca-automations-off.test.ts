import { describe, expect, it, vi } from 'vitest'
import {
  isOrcaAutomationsOff,
  keepOrcaAutomationsOff,
  ORCA_AUTOMATIONS_OFF
} from './orca-automations-off'

describe('isOrcaAutomationsOff', () => {
  it.each([
    { inElectron: true, env: {}, expected: true },
    { inElectron: true, env: { PILOT_ORCA_AUTOMATIONS: 'on' }, expected: false },
    { inElectron: true, env: { PILOT_ORCA_AUTOMATIONS: 'off' }, expected: true },
    { inElectron: false, env: {}, expected: false }
  ])('inElectron=$inElectron env=$env → $expected', ({ inElectron, env, expected }) => {
    expect(isOrcaAutomationsOff({ inElectron, env })).toBe(expected)
  })
})

function fakeService() {
  const start = vi.fn()
  const stop = vi.fn()
  const runNow = vi.fn(async (_id: string) => ({}))
  return { service: { start, stop, runNow }, start, stop, runNow }
}
const store = (enabled: boolean[]) => ({
  listAutomations: () => enabled.map((e, i) => ({ id: `a${i}`, enabled: e }))
})

describe('keepOrcaAutomationsOff', () => {
  it("stops Orca's service, keeps it from starting, refuses Run now, and says what won't run", async () => {
    const { service, start, stop } = fakeService()
    const logs: string[] = []
    keepOrcaAutomationsOff(service as never, store([true, false, true]) as never, {
      inElectron: true,
      env: {},
      log: (m) => logs.push(m)
    })
    expect(stop).toHaveBeenCalledTimes(1)
    service.start()
    expect(start).not.toHaveBeenCalled()
    await expect(service.runNow('a0')).rejects.toThrow(ORCA_AUTOMATIONS_OFF)
    expect(logs).toEqual([
      "[pilot] Orca's automation engine is off in Pilot: 2 enabled Orca automation(s) won't run here (PILOT_ORCA_AUTOMATIONS=on turns it back on)"
    ])
  })

  it.each([
    { inElectron: false, env: {} },
    { inElectron: true, env: { PILOT_ORCA_AUTOMATIONS: 'on' } }
  ])(
    'leaves the service as upstream built it when inElectron=$inElectron env=$env',
    ({ inElectron, env }) => {
      const { service, start, stop } = fakeService()
      keepOrcaAutomationsOff(service as never, store([true]) as never, {
        inElectron,
        env,
        log: () => {}
      })
      service.start()
      expect(stop).not.toHaveBeenCalled()
      expect(start).toHaveBeenCalledTimes(1)
    }
  )

  it("still turns the engine off when Orca's automation list can't be read", () => {
    const { service, stop } = fakeService()
    const logs: string[] = []
    const broken = {
      listAutomations: () => {
        throw new Error('store closed')
      }
    }
    keepOrcaAutomationsOff(service as never, broken as never, {
      inElectron: true,
      env: {},
      log: (m) => logs.push(m)
    })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(logs).toEqual([
      "[pilot] Orca's automation engine is off in Pilot (PILOT_ORCA_AUTOMATIONS=on turns it back on)"
    ])
  })
})
