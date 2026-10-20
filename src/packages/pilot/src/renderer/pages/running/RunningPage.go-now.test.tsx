// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HoldReason } from '../../../shared/api-types'
import type { CapacityPayload } from '../../../shared/api-types-capacity'
import { byHost, LOCAL_NAMED, MINI } from '../../hosts/__fixtures__/hosts'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../../hosts/pilot-hosts-feed'
import { capacity, waitingItem } from './__fixtures__/capacity'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { RunningPage } from './RunningPage'

const waiting = (scope: Pick<typeof screen, 'getByRole'> = screen) =>
  within(scope.getByRole('region', { name: 'Waiting' }))

afterEach(() => {
  cleanup()
  pilotRpc.mockReset()
  resetPilotHostsFeed()
})

describe('Go now on Running', () => {
  it.each<[string, HoldReason | undefined, boolean]>([
    ['a slot waiter', 'capacity', true],
    ['a slot waiter from an older Pilot', undefined, true],
    ['an item waiting out its retry', 'retry', true],
    ['an item over the per-tick limit', 'tick_limit', true],
    ['an item in a busy worktree', 'worktree_busy', false],
    ["an item its job's own run still works on", 'own_run', false],
    ['an item with an answer waiting to be applied', 'answers_pending', false]
  ])('on %s: %s', async (_name, holdCode, shows) => {
    pilotRpc.mockResolvedValue(capacity({ queued: [waitingItem({ holdCode })] }))
    render(<RunningPage />)
    await act(async () => {})
    expect(waiting().queryAllByRole('button', { name: 'Go now' })).toHaveLength(shows ? 1 : 0)
  })

  it("goes now on that card's machine, and shows what Pilot answered", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    const mini = (method: string): CapacityPayload =>
      method === 'pilot.capacity.goNow' ? capacity({ queued: [] }) : capacity()
    pilotRpc.mockImplementation(byHost({ local: () => capacity(), mini }))
    render(<RunningPage />)
    const region = within(await screen.findByRole('region', { name: 'Mac mini' }))
    await act(async () => fireEvent.click(waiting(region).getByRole('button', { name: 'Go now' })))
    expect(pilotRpc.mock.calls.filter(([m]) => m === 'pilot.capacity.goNow')).toEqual([
      ['pilot.capacity.goNow', { automationId: 'ci', itemKey: 'mr:9' }, { target: MINI.target }]
    ])
    expect(waiting(region).getByText('Nothing is waiting.')).toBeTruthy()
    const local = within(screen.getByRole('region', { name: 'MacBook' }))
    expect(waiting(local).getByRole('button', { name: 'Go now' })).toBeTruthy()
  })

  // An older Pilot has no pilot.capacity.goNow: its refusal shows on its machine, and nothing else breaks.
  it('shows the error a Pilot without Go now gives', async () => {
    pilotRpc.mockImplementation(async (method: string) => {
      if (method === 'pilot.capacity.goNow') {
        throw new Error('Unknown method: pilot.capacity.goNow')
      }
      return capacity()
    })
    render(<RunningPage />)
    await act(async () => {})
    await act(async () => fireEvent.click(waiting().getByRole('button', { name: 'Go now' })))
    expect(await screen.findByText('Unknown method: pilot.capacity.goNow')).toBeTruthy()
    expect(waiting().getByText('05 Fix failed CI')).toBeTruthy()
  })
})
