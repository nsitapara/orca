import { describe, expect, it } from 'vitest'
import { LOCAL_NAMED, MINI, MINI_OFFLINE } from './__fixtures__/hosts'
import { LOCAL_PILOT_HOST, type PilotHostEntry } from './pilot-host'
import { runsOnLine } from './runs-on-text'

describe('runsOnLine', () => {
  it.each<[string, string | null, PilotHostEntry[], { text: string; warn: boolean } | null]>([
    ['nothing without runs_on', null, [LOCAL_NAMED, MINI], null],
    [
      'the machine when it is connected',
      'mac mini',
      [LOCAL_NAMED, MINI],
      { text: 'Runs on Mac mini', warn: false }
    ],
    [
      'that it is unreachable',
      'Mac mini',
      [LOCAL_NAMED, MINI_OFFLINE],
      { text: "Runs on Mac mini · can't be reached", warn: true }
    ],
    [
      'that no connected Pilot has the name',
      'Linux box',
      [LOCAL_NAMED, MINI],
      { text: 'Runs on Linux box · no connected Pilot has that name', warn: true }
    ],
    [
      'no warning when this machine is the only one',
      'Linux box',
      [LOCAL_NAMED],
      { text: 'Runs on Linux box', warn: false }
    ],
    // The page's default feed: this machine alone, unprobed, so its name isn't known.
    [
      'no warning, the name as written, when only the unnamed local host is listed',
      '  Mac mini ',
      [LOCAL_PILOT_HOST],
      { text: 'Runs on Mac mini', warn: false }
    ]
  ])('says %s', (_w, runsOn, hosts, expected) =>
    expect(runsOnLine({ runsOn }, hosts)).toEqual(expected)
  )
})
