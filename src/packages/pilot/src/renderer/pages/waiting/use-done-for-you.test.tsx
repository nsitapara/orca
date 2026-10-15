// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testRun } from '../../../shared/run-views/__fixtures__/runs'
import type { DoneRun } from '../../../shared/visibility-types'

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

  it("ignores an older read that answers after Got it's newer one", async () => {
    const reads: ((runs: DoneRun[]) => void)[] = []
    pilotRpc.mockImplementation((method: string) => {
      if (method === 'pilot.runs.acknowledge') {
        return Promise.resolve({ acknowledged: ['old'], kept: [], notKept: [] })
      }
      return new Promise<DoneRun[]>((resolve) => reads.push(resolve))
    })
    const { result } = renderHook(() => useDoneForYou('nish'))
    let acknowledged: Promise<string | null> = Promise.resolve(null)
    act(() => {
      acknowledged = result.current.acknowledge(['old'])
    })
    await act(async () => {})
    expect(reads).toHaveLength(2)
    await act(async () => reads[1]([done('new')]))
    await act(async () => reads[0]([done('old'), done('new')]))
    expect(await acknowledged).toBeNull()
    expect(result.current.runs.map((d) => d.run.id)).toEqual(['new'])
  })
})
