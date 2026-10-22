import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import type { SessionTerminalState } from './agent-step'
import { findLiveTab, runtimeSessionTabs, terminalOpen, type SessionLook } from './session-tabs'

function look(
  states: Record<string, SessionTerminalState>,
  tabs: string[] = [],
  stepOn: string[] = []
): SessionLook {
  return {
    state: vi.fn(async (t) => states[t.handle] ?? 'gone'),
    tabs: vi.fn(async () => tabs.map((handle) => ({ handle, paneKey: `${handle}:leaf` }))),
    stepOn: (h) => stepOn.includes(h)
  }
}

describe('findLiveTab', () => {
  it('finds a tab no step row names, across all terminals', async () => {
    expect(await findLiveTab(look({ user_tab: 'free' }, ['user_tab']), 's1')).toEqual({
      handle: 'user_tab',
      paneKey: 'user_tab:leaf',
      state: 'free'
    })
  })

  it('skips gone tabs and tabs running another session', async () => {
    expect(await findLiveTab(look({ a: 'gone', b: 'other' }, ['a', 'b']), 's1')).toBeNull()
  })

  it('a busy tab wins over a free one; a Pilot step on a tab makes it busy without a look', async () => {
    const l = look({ a: 'free', b: 'free' }, ['a', 'b'], ['b'])
    expect((await findLiveTab(l, 's1'))?.handle).toBe('b')
    expect(l.state).toHaveBeenCalledTimes(1)
  })

  it('does not ask for more tabs when a hint is busy, and never judges an excluded handle twice', async () => {
    const l = look({ h: 'busy', x: 'free' }, ['x'])
    expect((await findLiveTab(l, 's1', [{ handle: 'h', paneKey: null }]))?.state).toBe('busy')
    expect(l.tabs).not.toHaveBeenCalled()
    expect(await findLiveTab(look({ x: 'free' }, ['x']), 's1', [], new Set(['x']))).toBeNull()
  })

  it('reads an unreadable tab as busy', async () => {
    const l: SessionLook = {
      state: vi.fn().mockRejectedValue(new Error('x')),
      tabs: async () => [{ handle: 'a', paneKey: null }],
      stepOn: () => false
    }
    expect((await findLiveTab(l, 's1'))?.state).toBe('busy')
  })
})

describe('runtimeSessionTabs', () => {
  const row = (paneKey: string, id: string, receivedAt = 1) => ({
    paneKey,
    receivedAt,
    providerSession: { key: 'session_id', id }
  })
  const runtime = (rows: unknown[], terminals: unknown[], paneRows?: Record<string, unknown[]>) =>
    ({
      getAgentProviderSessionRows: () => rows,
      getAgentStatusRowsForPane: (paneKey: string) =>
        paneRows
          ? (paneRows[paneKey] ?? [])
          : rows.filter((r) => (r as { paneKey: string }).paneKey === paneKey),
      listTerminals: vi.fn(async () => ({
        terminals,
        truncated: false,
        totalCount: terminals.length
      }))
    }) as unknown as OrcaRuntimeService

  it("lists the connected terminals whose pane's newest session row is this session", async () => {
    const rt = runtime(
      [row('t1:l1', 's1'), row('t2:l2', 's2'), row('t3:l3', 's1', 1), row('t3:l3', 's9', 5)],
      [
        { handle: 'h1', tabId: 't1', leafId: 'l1', connected: true },
        { handle: 'h2', tabId: 't2', leafId: 'l2', connected: true },
        { handle: 'h3', tabId: 't3', leafId: 'l3', connected: true }
      ]
    )
    expect(await runtimeSessionTabs(rt)('s1')).toEqual([{ handle: 'h1', paneKey: 't1:l1' }])
  })

  it('ignores a disconnected terminal, and lists nothing without a row', async () => {
    const rt = runtime(
      [row('t1:l1', 's1')],
      [{ handle: 'h1', tabId: 't1', leafId: 'l1', connected: false }]
    )
    expect(await runtimeSessionTabs(rt)('s1')).toEqual([])
    expect(await runtimeSessionTabs(runtime([], []))('s1')).toEqual([])
  })

  it("judges each candidate pane by the pane's own rows (as the per-pane check does), not the global table", async () => {
    const rt = runtime(
      [row('t1:l1', 's1'), row('t2:l2', 's1')],
      [
        { handle: 'h1', tabId: 't1', leafId: 'l1', connected: true },
        { handle: 'h2', tabId: 't2', leafId: 'l2', connected: true }
      ],
      { 't1:l1': [row('t1:l1', 's1')], 't2:l2': [row('t2:l2', 's-other')] }
    )
    expect(await runtimeSessionTabs(rt)('s1')).toEqual([{ handle: 'h1', paneKey: 't1:l1' }])
  })
})

describe('terminalOpen', () => {
  type TerminalListing = { terminals: { handle: string; connected: boolean }[]; truncated: boolean }
  const runtime = (listing: TerminalListing) =>
    ({ listTerminals: vi.fn(async () => listing) }) as unknown as OrcaRuntimeService

  it.each([
    ['connected', { terminals: [{ handle: 'h1', connected: true }], truncated: false }, true],
    ['disconnected', { terminals: [{ handle: 'h1', connected: false }], truncated: false }, false],
    ['absent from a complete listing', { terminals: [], truncated: false }, false],
    ['absent from a truncated listing: unknown, so open', { terminals: [], truncated: true }, true]
  ])('%s', async (_name, listing, expected) => {
    expect(await terminalOpen(runtime(listing), 'h1')).toBe(expected)
  })

  // Two teardowns listing at once: Orca drops the older untargeted listing as superseded (terminal_liveness_unavailable),
  // which kept throwaways from being removed for a day (2026-10-22). It is asked again; anything else isn't.
  it('asks again when Orca drops its listing for a newer one, and gives up after a few tries', async () => {
    const superseded = new Error('terminal_liveness_unavailable')
    const open = { terminals: [{ handle: 'h1', connected: true }], truncated: false }
    const flaky = vi.fn().mockRejectedValueOnce(superseded).mockResolvedValueOnce(open)
    const noWait = async () => {}
    expect(await terminalOpen({ listTerminals: flaky }, 'h1', noWait)).toBe(true)
    const never = vi.fn().mockRejectedValue(superseded)
    await expect(terminalOpen({ listTerminals: never }, 'h1', noWait)).rejects.toThrow(
      'terminal_liveness_unavailable'
    )
    expect(never).toHaveBeenCalledTimes(4)
    const other = vi.fn().mockRejectedValue(new Error('invalid_limit'))
    await expect(terminalOpen({ listTerminals: other }, 'h1', noWait)).rejects.toThrow(
      'invalid_limit'
    )
    expect(other).toHaveBeenCalledTimes(1)
  })
})
