import { beforeEach, describe, expect, it, vi } from 'vitest'

const callRuntimeRpc = vi.fn()
vi.mock('@/runtime/runtime-rpc-client', () => ({
  callRuntimeRpc: (...args: unknown[]) => callRuntimeRpc(...args)
}))

import { pilotRpc } from './api'

describe('pilotRpc', () => {
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

  it('passes a longer timeout through to callRuntimeRpc', async () => {
    await pilotRpc('pilot.automations.dryRun', { id: 'a' }, { timeoutMs: 180_000 })
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'local' },
      'pilot.automations.dryRun',
      { id: 'a' },
      { timeoutMs: 180_000 }
    )
  })

  it('sends a call to the environment it names', async () => {
    const target = { kind: 'environment', environmentId: 'mini' } as const
    await pilotRpc('pilot.inbox.list', {}, { target })
    expect(callRuntimeRpc).toHaveBeenCalledWith(
      target,
      'pilot.inbox.list',
      {},
      { timeoutMs: 15_000 }
    )
  })
})
