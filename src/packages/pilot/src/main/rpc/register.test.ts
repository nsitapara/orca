import { describe, expect, it } from 'vitest'
import { registerPilotRpcMethods } from './register'

const method = (name: string) => ({
  name,
  permission: 'workspace',
  params: null,
  handler: () => null
})

describe('registerPilotRpcMethods', () => {
  it('appends Pilot methods to the registry it is given', () => {
    const registry: unknown[] = [method('automation.list')]
    registerPilotRpcMethods(registry, [method('pilot.status')])
    expect(registry.map((m) => (m as { name: string }).name)).toEqual([
      'automation.list',
      'pilot.status'
    ])
  })

  it('is idempotent when called twice (desktop + serve share a process)', () => {
    const registry: unknown[] = []
    registerPilotRpcMethods(registry, [method('pilot.status')])
    registerPilotRpcMethods(registry, [method('pilot.status')])
    expect(registry).toHaveLength(1)
  })

  it('refuses a Pilot method that collides with an upstream name', () => {
    const registry: unknown[] = [method('pilot.status')]
    ;(registry[0] as { upstream?: boolean }).upstream = true
    expect(() =>
      registerPilotRpcMethods(registry, [{ ...method('pilot.status'), pilot: true }])
    ).toThrow('Pilot RPC method pilot.status collides with an existing method')
  })
})
