// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Effect } from '../../shared/visibility-types'
import { byHost, LOCAL_NAMED, MINI } from '../hosts/__fixtures__/hosts'
import type { PilotHostRef } from '../hosts/pilot-host'
import {
  resetPilotHostsFeed,
  setPilotHostsForTests,
  usePilotHosts
} from '../hosts/pilot-hosts-feed'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import {
  EFFECTS_REFRESH_MS,
  EFFECTS_RETRY_MS,
  resetEffectsFeed,
  useRunEffects
} from './effects-feed'

const PUSHED: Effect = { kind: 'pushed', target: 'web-1', url: null, count: 1, stepIdx: 0, at: 1 }

function Probe({
  id,
  live = false,
  host,
  name = id
}: {
  id: string
  live?: boolean
  host?: PilotHostRef
  name?: string
}): React.JSX.Element {
  const effects = useRunEffects(id, live, host)
  return <span data-testid={name}>{effects === null ? 'none' : String(effects.length)}</span>
}

// A run on the last listed machine, as the Running page shows each machine's runs.
function ListedProbe(): React.JSX.Element {
  const hosts = usePilotHosts()
  return <Probe id="r1" host={hosts.at(-1)} />
}

describe('useRunEffects', () => {
  afterEach(() => {
    cleanup()
    resetEffectsFeed()
    resetPilotHostsFeed()
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

  it("asks each machine for its own runs' effects, and keeps two machines' same-id runs apart (Review Focus 1)", async () => {
    pilotRpc.mockImplementation(
      byHost({ local: () => ({ r1: [PUSHED] }), mini: () => ({ r1: [PUSHED, PUSHED] }) })
    )
    render(
      <>
        <Probe id="r1" />
        <Probe id="r1" host={MINI} name="mini" />
      </>
    )
    await act(async () => {})
    expect([screen.getByTestId('r1').textContent, screen.getByTestId('mini').textContent]).toEqual([
      '1',
      '2'
    ])
    expect(pilotRpc.mock.calls).toEqual([
      ['pilot.runs.effects', { runIds: ['r1'] }],
      ['pilot.runs.effects', { runIds: ['r1'] }, { target: MINI.target }]
    ])
  })

  it("still shows one machine's effects when another machine's read fails", async () => {
    // Mac mini has no answer, so its read fails.
    pilotRpc.mockImplementation(byHost({ local: () => ({ r1: [PUSHED] }) }))
    render(
      <>
        <Probe id="r1" />
        <Probe id="r1" host={MINI} name="mini" />
      </>
    )
    await act(async () => {})
    expect([screen.getByTestId('r1').textContent, screen.getByTestId('mini').textContent]).toEqual([
      '1',
      'none'
    ])
  })

  it('asks no machine again when the listed machines refresh unchanged', async () => {
    // Each refresh brings new objects with the same data, as a hosts probe does.
    setPilotHostsForTests([{ ...LOCAL_NAMED }, { ...MINI }])
    pilotRpc.mockResolvedValue({})
    render(<ListedProbe />)
    await act(async () => {})
    act(() => setPilotHostsForTests([{ ...LOCAL_NAMED }, { ...MINI }]))
    await act(async () => {})
    expect(pilotRpc).toHaveBeenCalledTimes(1)
  })
})
