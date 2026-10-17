import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MINI } from './__fixtures__/hosts'
import { LOCAL_PILOT_HOST } from './pilot-host'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { hostRpc } from './host-rpc'

describe('hostRpc', () => {
  beforeEach(() => {
    pilotRpc.mockReset()
    pilotRpc.mockResolvedValue('ok')
  })

  it.each([
    [
      'with params',
      () => hostRpc(LOCAL_PILOT_HOST, 'pilot.inbox.list', { person: 'nish' }),
      ['pilot.inbox.list', { person: 'nish' }]
    ],
    [
      'with no params',
      () => hostRpc(LOCAL_PILOT_HOST, 'pilot.playground.stop'),
      ['pilot.playground.stop']
    ],
    [
      'with options',
      () =>
        hostRpc(LOCAL_PILOT_HOST, 'pilot.automations.dryRun', { id: 'a' }, { timeoutMs: 180_000 }),
      ['pilot.automations.dryRun', { id: 'a' }, { timeoutMs: 180_000 }]
    ]
  ])("keeps this machine's call exactly as the caller made it, %s", async (_w, call, expected) => {
    await call()
    expect(pilotRpc.mock.calls).toStrictEqual([expected])
  })

  it.each([
    [{ timeoutMs: 180_000 }, { timeoutMs: 180_000, target: MINI.target }],
    [undefined, { target: MINI.target }]
  ])("adds another machine's target to the caller's options (%o)", async (opts, expected) => {
    await hostRpc(MINI, 'pilot.automations.tickNow', { id: 'x' }, opts)
    expect(pilotRpc).toHaveBeenCalledWith('pilot.automations.tickNow', { id: 'x' }, expected)
  })
})
