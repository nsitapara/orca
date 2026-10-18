import { describe, expect, it, vi } from 'vitest'
import { recheckPruner } from './housekeep'

describe('recheckPruner', () => {
  it('prunes re-check ticks at most once an hour, and logs only what it removed', () => {
    let clock = 0
    const pruneRechecks = vi.fn().mockReturnValueOnce(3).mockReturnValue(0)
    const log = vi.fn()
    const prune = recheckPruner({ pruneRechecks }, () => clock, log)
    prune()
    clock = 59 * 60_000
    prune()
    clock = 60 * 60_000
    prune()
    expect(pruneRechecks.mock.calls).toEqual([[0], [60 * 60_000]])
    expect(log.mock.calls).toEqual([['[pilot] store: 3 re-check tick(s) older than a day removed']])
  })
})
