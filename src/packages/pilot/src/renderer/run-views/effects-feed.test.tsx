// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Effect } from '../../shared/visibility-types'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import {
  EFFECTS_REFRESH_MS,
  EFFECTS_RETRY_MS,
  resetEffectsFeed,
  useRunEffects
} from './effects-feed'

const PUSHED: Effect = { kind: 'pushed', target: 'web-1', url: null, count: 1, stepIdx: 0, at: 1 }

function Probe({ id, live = false }: { id: string; live?: boolean }): React.JSX.Element {
  const effects = useRunEffects(id, live)
  return <span data-testid={id}>{effects === null ? 'none' : String(effects.length)}</span>
}

describe('useRunEffects', () => {
  afterEach(() => {
    cleanup()
    resetEffectsFeed()
    pilotRpc.mockReset()
    vi.useRealTimers()
  })

  it('asks for every run on screen in one call, and reads a malformed answer as no effects', async () => {
    pilotRpc.mockResolvedValue({ a: [PUSHED], b: 'junk' })
    render(
      <>
        <Probe id="a" />
        <Probe id="b" />
      </>
    )
    expect((await screen.findByTestId('a')).textContent).toBe('1')
    await act(async () => {})
    expect(screen.getByTestId('b').textContent).toBe('0')
    expect(pilotRpc).toHaveBeenCalledTimes(1)
    expect(pilotRpc).toHaveBeenCalledWith('pilot.runs.effects', { runIds: ['a', 'b'] })
  })

  it('keeps only well-formed effects', async () => {
    pilotRpc.mockResolvedValue({ a: [PUSHED, null, { kind: 1 }] })
    render(<Probe id="a" />)
    await act(async () => {})
    expect(screen.getByTestId('a').textContent).toBe('1')
  })

  it('asks once more after 5 s when a read fails', async () => {
    vi.useFakeTimers()
    pilotRpc.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ a: [PUSHED] })
    render(<Probe id="a" />)
    await act(async () => {})
    expect(screen.getByTestId('a').textContent).toBe('none')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EFFECTS_RETRY_MS)
    })
    expect(screen.getByTestId('a').textContent).toBe('1')
    expect(pilotRpc).toHaveBeenCalledTimes(2)
  })

  it('asks once more when a run goes from live to finished, and not again while it stays finished', async () => {
    pilotRpc.mockResolvedValue({})
    const { rerender } = render(<Probe id="a" live />)
    await act(async () => {})
    rerender(<Probe id="a" live={false} />)
    await act(async () => {})
    expect(pilotRpc).toHaveBeenCalledTimes(2)
    rerender(<Probe id="a" live={false} />)
    await act(async () => {})
    expect(pilotRpc).toHaveBeenCalledTimes(2)
  })

  it('asks again every 10 s for a live run, and not for a finished one', async () => {
    vi.useFakeTimers()
    pilotRpc.mockResolvedValue({})
    render(
      <>
        <Probe id="live" live />
        <Probe id="done" />
      </>
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EFFECTS_REFRESH_MS)
    })
    const asked = pilotRpc.mock.calls.flatMap((c) => (c[1] as { runIds: string[] }).runIds)
    expect(asked.filter((id) => id === 'live')).toHaveLength(2)
    expect(asked.filter((id) => id === 'done')).toHaveLength(1)
  })
})
