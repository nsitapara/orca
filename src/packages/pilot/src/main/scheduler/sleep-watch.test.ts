import { describe, expect, it } from 'vitest'
import { BEAT_MS, SLEEP_GAP_MS, SleepWatch } from './sleep-watch'

describe('SleepWatch.sleptSince', () => {
  const start = 1_000_000
  const minute = 60_000

  it.each([
    {
      name: 'steady beats: no sleep',
      beats: [BEAT_MS, BEAT_MS, BEAT_MS],
      since: start,
      want: false
    },
    {
      name: 'a 15-minute gap after the tick began',
      beats: [BEAT_MS, 15 * minute],
      since: start,
      want: true
    },
    {
      name: 'a gap that ended before the tick began',
      beats: [15 * minute, BEAT_MS],
      since: start + 15 * minute + 1,
      want: false
    },
    { name: 'a gap just over the limit', beats: [SLEEP_GAP_MS + 1], since: start, want: true },
    { name: 'a gap at the limit is not a sleep', beats: [SLEEP_GAP_MS], since: start, want: false }
  ])('$name', ({ beats, since, want }) => {
    let clock = start
    const watch = new SleepWatch(() => clock)
    for (const step of beats) {
      clock += step
      watch.beat()
    }
    expect(watch.sleptSince(since)).toBe(want)
  })

  // On wake, a glab deadline timer can fire before the heartbeat's: the gap not yet beaten counts.
  it('counts a sleep the heartbeat has not beaten yet', () => {
    let clock = start
    const watch = new SleepWatch(() => clock)
    clock += 15 * minute
    expect(watch.sleptSince(start)).toBe(true)
  })
})
