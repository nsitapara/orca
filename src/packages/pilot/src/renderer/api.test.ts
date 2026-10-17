import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const callRuntimeRpc = vi.fn()
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: (...args: unknown[]) => callRuntimeRpc(...args)
}))

import { pilotRpc } from './api'

describe('pilotRpc', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  beforeEach(() => {
    callRuntimeRpc.mockReset()
    callRuntimeRpc.mockResolvedValue('ok')
  })

  it('keeps the 15 s default timeout', async () => {
    await pilotRpc('pilot.status')
    expect(callRuntimeRpc).toHaveBeenCalledWith({ kind: 'local' }, 'pilot.status', undefined, {
      timeoutMs: 15_000
    })
  })

  it.each([
    ['the desktop', undefined, { kind: 'local' }],
    [
      'the browser version',
      { __ORCA_WEB_CLIENT__: true, location: { pathname: '/web-index.html' } },
      { kind: 'environment', environmentId: 'active' }
    ]
  ])('keeps a long timeout on %s', async (_where, windowStub, target) => {
    if (windowStub) {
      vi.stubGlobal('window', windowStub)
    }
    await pilotRpc('pilot.automations.dryRun', { id: 'a' }, { timeoutMs: 180_000 })
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      target,
      'pilot.automations.dryRun',
      { id: 'a' },
      { timeoutMs: 180_000 }
    )
  })
})
