import { describe, expect, it } from 'vitest'
import { LOCAL_NAMED, MINI, MINI_OFFLINE } from './__fixtures__/hosts'
import { hostsNoticeLines } from './hosts-notice-text'

describe('hostsNoticeLines', () => {
  it.each([
    [
      'an offline machine',
      [LOCAL_NAMED, MINI_OFFLINE],
      [],
      ["Mac mini can't be reached: its cards aren't shown here."]
    ],
    [
      'a failed read on another machine',
      [LOCAL_NAMED, MINI],
      [{ host: MINI, error: 'timeout' }],
      ["Couldn't refresh Mac mini's cards: timeout"]
    ],
    [
      "this machine's own failure, by its name, when another machine answered",
      [LOCAL_NAMED, MINI],
      [{ host: LOCAL_NAMED, error: 'x' }],
      ["Couldn't refresh MacBook's cards: x"]
    ],
    [
      'nothing when every machine failed (the page says it once)',
      [LOCAL_NAMED, MINI],
      [
        { host: LOCAL_NAMED, error: 'x' },
        { host: MINI, error: 'timeout' }
      ],
      []
    ],
    [
      "nothing for the only machine's failure (the page shows it)",
      [LOCAL_NAMED],
      [{ host: LOCAL_NAMED, error: 'x' }],
      []
    ],
    [
      'one line for an offline machine whose read also failed',
      [LOCAL_NAMED, MINI_OFFLINE],
      [{ host: MINI_OFFLINE, error: 'timeout' }],
      ["Mac mini can't be reached: its cards aren't shown here."]
    ]
  ])('says %s', (_what, hosts, reads, lines) => {
    expect(hostsNoticeLines(hosts, reads, 'cards')).toEqual(lines)
  })

  it('says each kind of read in its own words, each line once', () => {
    const twin = {
      ...MINI,
      key: 'env:mini-2',
      target: { kind: 'environment' as const, environmentId: 'mini-2' }
    }
    const cards = [
      { host: MINI, error: 'timeout' },
      { host: twin, error: 'timeout' }
    ]
    const queue = { reads: [{ host: LOCAL_NAMED, error: 'busy' }], what: 'queued answers' }
    expect(hostsNoticeLines([LOCAL_NAMED, MINI, twin], cards, 'cards', [queue])).toEqual([
      "Couldn't refresh Mac mini's cards: timeout",
      "Couldn't refresh MacBook's queued answers: busy"
    ])
  })
})
