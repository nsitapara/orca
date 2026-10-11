import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../../../../main/runtime/orca-runtime'
import { RELIST_REUSE_MS, terminalRelister } from './terminal-relist'

type Listed = {
  handle: string
  tabId: string
  leafId: string
  connected: boolean
  recordedPaneKey?: string
}

function runtimeListing(...listings: (Listed[] | Error)[]) {
  const listTerminals = vi.fn(async () => {
    const next = listings.length > 1 ? listings.shift()! : listings[0]
    if (next instanceof Error) {
      throw next
    }
    return { terminals: next, totalCount: next.length, truncated: false }
  })
  return { runtime: { listTerminals } as unknown as OrcaRuntimeService, listTerminals }
}

const term = (over: Partial<Listed>): Listed => ({
  handle: 'term_other',
  tabId: 'tab-x',
  leafId: 'leaf-x',
  connected: true,
  ...over
})

describe('terminalRelister', () => {
  // After a restart the daemon's inventory re-adopts the handle the PTY was spawned with, or at least
  // restores its pane: either one means the agent's terminal is still open.
  it.each([
    ['its handle', [term({ handle: 'term_1' })], true],
    ['its pane', [term({ tabId: 'tab-1', leafId: 'leaf-1' })], true],
    ['its recorded pane (an orphaned PTY)', [term({ recordedPaneKey: 'tab-1:leaf-1' })], true],
    ['only a disconnected match', [term({ handle: 'term_1', connected: false })], false],
    ['other terminals only', [term({})], false],
    ['nothing', [], false]
  ])('finds the terminal by %s: %s', async (_name, terminals, alive) => {
    const { runtime, listTerminals } = runtimeListing(terminals)
    expect(await terminalRelister(runtime)('term_1', 'tab-1:leaf-1')).toBe(alive)
    expect(listTerminals).toHaveBeenCalledWith(undefined, expect.any(Number), {
      requireFreshPtyLiveness: true,
      includeVisualLayouts: false
    })
  })

  it('matches only the handle when the step has no pane', async () => {
    const { runtime } = runtimeListing([term({ tabId: 'tab-1', leafId: 'leaf-1' })])
    expect(await terminalRelister(runtime)('term_1', null)).toBe(false)
  })

  it('shares one listing for a few seconds, then lists again', async () => {
    let now = 0
    const { runtime, listTerminals } = runtimeListing([term({ handle: 'term_1' })])
    const relist = terminalRelister(runtime, () => now)
    await relist('term_1', null)
    await relist('term_2', null)
    expect(listTerminals).toHaveBeenCalledTimes(1)
    now = RELIST_REUSE_MS
    await relist('term_1', null)
    expect(listTerminals).toHaveBeenCalledTimes(2)
  })

  it("throws when liveness can't be proven, and asks again next time", async () => {
    const { runtime, listTerminals } = runtimeListing(new Error('terminal_liveness_unavailable'), [
      term({ handle: 'term_1' })
    ])
    const relist = terminalRelister(runtime, () => 0)
    await expect(relist('term_1', null)).rejects.toThrow('terminal_liveness_unavailable')
    expect(await relist('term_1', null)).toBe(true)
    expect(listTerminals).toHaveBeenCalledTimes(2)
  })

  it('throws on a cut-short listing rather than calling a terminal closed', async () => {
    const listTerminals = async () => ({ terminals: [], totalCount: 20_000, truncated: true })
    const relist = terminalRelister({ listTerminals } as unknown as OrcaRuntimeService)
    await expect(relist('term_1', null)).rejects.toThrow('cut short')
  })
})
