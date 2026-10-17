// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testRun } from '../../../shared/run-views/__fixtures__/runs'
import type { DoneRun } from '../../../shared/visibility-types'
import { byHost, LOCAL_NAMED, MINI } from '../../hosts/__fixtures__/hosts'
import { hostOf, LOCAL_PILOT_HOST } from '../../hosts/pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from '../../hosts/pilot-hosts-feed'

const pilotRpc = vi.fn()
vi.mock('../../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { useDoneForYou } from './use-done-for-you'

const done = (id: string): DoneRun => ({
  run: { ...testRun({ id, status: 'done' }), fields: {} },
  effects: [],
  defaults: []
})

describe('useDoneForYou', () => {
  afterEach(() => {
    cleanup()
    resetPilotHostsFeed()
    pilotRpc.mockReset()
  })

  it('keeps only well-formed rows of the answer', async () => {
    pilotRpc.mockResolvedValue([
      done('ok'),
      null,
      'junk',
      { run: { id: 7 }, effects: [], defaults: [] },
      { run: { id: 'x' }, effects: 'no', defaults: [] },
      { run: { id: 'y' }, effects: [] }
    ])
    const { result } = renderHook(() => useDoneForYou(null))
    await act(async () => {})
    expect(result.current.runs.map((d) => d.run.id)).toEqual(['ok'])
  })

  // One read at a time per machine: Got it's read starts after the one in flight, so an older answer never lands last.
  it("settles Got it on a list read after the acknowledge, never an older read's", async () => {
    const reads: ((runs: DoneRun[]) => void)[] = []
    pilotRpc.mockImplementation((method: string) => {
      if (method === 'pilot.runs.acknowledge') {
        return Promise.resolve({ acknowledged: ['old'], kept: [], notKept: [] })
      }
      return new Promise<DoneRun[]>((resolve) => reads.push(resolve))
    })
    const { result } = renderHook(() => useDoneForYou('nish'))
    await act(async () => {})
    let acknowledged: Promise<string | null> = Promise.resolve(null)
    let settled = false
    act(() => {
      acknowledged = result.current.acknowledge([{ id: 'old', host: LOCAL_PILOT_HOST }])
      void acknowledged.then(() => (settled = true))
    })
    await act(async () => {})
    expect(reads).toHaveLength(1)
    await act(async () => reads[0]([done('old'), done('new')]))
    expect(reads).toHaveLength(2)
    expect(settled).toBe(false)
    await act(async () => reads[1]([done('new')]))
    expect(await acknowledged).toBeNull()
    expect(result.current.runs.map((d) => d.run.id)).toEqual(['new'])
  })

  it("lists every machine's finished runs, each tagged with its machine", async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(byHost({ local: () => [done('r1')], mini: () => [done('r1')] }))
    const { result } = renderHook(() => useDoneForYou(null))
    await waitFor(() =>
      expect(result.current.runs.map((d) => [d.run.id, hostOf(d.run).key])).toEqual([
        ['r1', 'local'],
        ['r1', 'env:mini']
      ])
    )
  })

  it.each([
    ['several machines were asked', [LOCAL_NAMED, MINI]],
    ['only that machine was asked, with more than one listed', [MINI]]
  ])("names the machine that couldn't acknowledge when %s", async (_case, asked) => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(
      byHost({
        local: () => [],
        mini: (method) => {
          if (method === 'pilot.runs.acknowledge') {
            throw new Error('Pilot is busy')
          }
          return []
        }
      })
    )
    const { result } = renderHook(() => useDoneForYou(null))
    await act(async () => {})
    let failed: string | null = null
    await act(async () => {
      failed = await result.current.acknowledge(asked.map((host) => ({ id: 'r1', host })))
    })
    expect(failed).toBe('Mac mini: Pilot is busy')
  })
})
