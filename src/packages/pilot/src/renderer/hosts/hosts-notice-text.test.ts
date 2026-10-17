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
      "nothing for this machine's own failure (the page shows it)",
      [LOCAL_NAMED, MINI],
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
})
