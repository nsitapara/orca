import { describe, expect, it, vi } from 'vitest'
import type { RpcCallerIdentity } from '../../../../../main/runtime/rpc/rpc-caller-identity'
import { SCHEDULER_OFF } from '../scheduler/scheduler'
import { CONTINUE_FROM_PILOT, continueRunCall, STOP_FROM_PILOT, stopRunCall } from './methods-runs'

describe('pilot.runs.continue', () => {
  const RESULT = { step: 'review', resumed: true }

  it('continues the run for the desktop app', async () => {
    const continueRun = vi.fn(async () => RESULT)
    const ctx = { schedulerOn: true, continueRun }
    await expect(continueRunCall(ctx, 'run-1', { kind: 'desktop' })).resolves.toEqual(RESULT)
    expect(continueRun).toHaveBeenCalledWith('run-1')
  })

  it.each<[string, RpcCallerIdentity | undefined, boolean, string]>([
    ['an agent over the local CLI', { kind: 'local-cli' }, true, CONTINUE_FROM_PILOT],
    ['a paired device', { kind: 'paired-device', deviceId: 'd1' }, true, CONTINUE_FROM_PILOT],
    ['a caller with no identity', undefined, true, CONTINUE_FROM_PILOT],
    [
      'the desktop app in a process without the scheduler',
      { kind: 'desktop' },
      false,
      SCHEDULER_OFF
    ]
  ])('refuses %s, continuing nothing', async (_name, caller, schedulerOn, why) => {
    const continueRun = vi.fn(async () => RESULT)
    await expect(continueRunCall({ schedulerOn, continueRun }, 'run-1', caller)).rejects.toThrow(
      why
    )
    expect(continueRun).not.toHaveBeenCalled()
  })
})

describe('pilot.runs.stop', () => {
  const STOPPED = { stopped: true as const }

  it.each<[string, RpcCallerIdentity]>([
    ['the desktop app', { kind: 'desktop' }],
    ["another machine's Pilot, as a paired device", { kind: 'paired-device', deviceId: 'd1' }]
  ])('stops the run for %s', async (_name, caller) => {
    const stopRun = vi.fn(async () => STOPPED)
    const ctx = { schedulerOn: true, stopRun }
    await expect(stopRunCall(ctx, 'run-1', caller)).resolves.toEqual(STOPPED)
    expect(stopRun).toHaveBeenCalledWith('run-1')
  })

  it.each<[string, RpcCallerIdentity | undefined, boolean, string]>([
    ['an agent over the local CLI', { kind: 'local-cli' }, true, STOP_FROM_PILOT],
    ['a caller with no identity', undefined, true, STOP_FROM_PILOT],
    [
      'the desktop app in a process without the scheduler',
      { kind: 'desktop' },
      false,
      SCHEDULER_OFF
    ]
  ])('refuses %s, stopping nothing', async (_name, caller, schedulerOn, why) => {
    const stopRun = vi.fn(async () => STOPPED)
    await expect(stopRunCall({ schedulerOn, stopRun }, 'run-1', caller)).rejects.toThrow(why)
    expect(stopRun).not.toHaveBeenCalled()
  })
})
