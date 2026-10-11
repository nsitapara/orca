import { describe, expect, it } from 'vitest'
import { mapLimit } from './map-limit'

describe('mapLimit', () => {
  it('keeps input order and never runs more than the limit at once', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, n))
      inFlight -= 1
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBe(2)
  })

  it('returns an empty list for no items', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([])
  })
})
