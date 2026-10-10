import { afterEach, describe, expect, it, vi } from 'vitest'
import { pilotRuntimeWsOptions } from './runtime-ws-port'

describe('pilotRuntimeWsOptions', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each([
    { name: 'outside Electron', inElectron: false, env: {}, expected: {} },
    { name: 'default', inElectron: true, env: {}, expected: { wsPort: 6868 } },
    {
      name: 'override',
      inElectron: true,
      env: { PILOT_WS_PORT: '7001' },
      expected: { wsPort: 7001 }
    },
    { name: 'not a number', inElectron: true, env: { PILOT_WS_PORT: 'abc' }, expected: {} },
    { name: 'zero', inElectron: true, env: { PILOT_WS_PORT: '0' }, expected: {} },
    { name: 'too big', inElectron: true, env: { PILOT_WS_PORT: '65536' }, expected: {} },
    { name: 'fraction', inElectron: true, env: { PILOT_WS_PORT: '80.5' }, expected: {} }
  ])('$name', ({ inElectron, env, expected }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(pilotRuntimeWsOptions({ inElectron, env })).toEqual(expected)
  })

  it('warns on an invalid port', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    pilotRuntimeWsOptions({ inElectron: true, env: { PILOT_WS_PORT: 'x' } })
    expect(warn).toHaveBeenCalledOnce()
  })
})
