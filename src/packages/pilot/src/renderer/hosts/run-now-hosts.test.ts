import { describe, expect, it } from 'vitest'
import { LOCAL_NAMED, MINI, MINI_OFFLINE } from './__fixtures__/hosts'
import type { PilotHostEntry } from './pilot-host'
import { runNowAway, runNowBlocked, runNowChoices, runNowHeld, runNowPick } from './run-now-hosts'

const LINUX: PilotHostEntry = {
  ...MINI,
  key: 'env:linux',
  target: { kind: 'environment', environmentId: 'linux' },
  machineName: 'Linux box'
}
const MINI_OFF: PilotHostEntry = { ...MINI, schedulerOn: false }

const offered = (choices: ReturnType<typeof runNowChoices>['choices']) =>
  choices.map((c) => [c.host.key, c.label, c.disabled, c.short])

describe('runNowChoices', () => {
  it.each<[string, string | null, PilotHostEntry[], string]>([
    ['the machine runs_on names', 'Mac mini', [LOCAL_NAMED, MINI], 'env:mini'],
    ['this machine without runs_on', null, [LOCAL_NAMED, MINI], 'local'],
    [
      'this machine when runs_on names one that is unreachable',
      'Mac mini',
      [LOCAL_NAMED, MINI_OFFLINE],
      'local'
    ],
    [
      'the other machine when this one has its scheduler off',
      null,
      [{ ...LOCAL_NAMED, schedulerOn: false }, MINI],
      'env:mini'
    ]
  ])('defaults to %s', (_w, runsOn, hosts, key) =>
    expect(runNowChoices({ runsOn, hosts }, hosts).preferred).toBe(key)
  )

  it('matches runs_on in any case, and passes over a runs_on machine whose scheduler is off', () => {
    expect(
      runNowChoices({ runsOn: ' mac MINI ', hosts: [LOCAL_NAMED, MINI] }, [LOCAL_NAMED, MINI])
    ).toMatchObject({ preferred: 'env:mini' })
    expect(
      runNowChoices({ runsOn: 'Mac mini', hosts: [LOCAL_NAMED, MINI_OFF] }, [LOCAL_NAMED, MINI_OFF])
    ).toMatchObject({ preferred: 'local' })
  })

  it("offers only machines that loaded the job, and says why one can't start it", () => {
    const { choices } = runNowChoices({ runsOn: null, hosts: [LOCAL_NAMED, MINI_OFF] }, [
      LOCAL_NAMED,
      MINI_OFF,
      LINUX
    ])
    expect(offered(choices)).toEqual([
      ['local', 'MacBook', null, null],
      ['env:mini', 'Mac mini', "Pilot's scheduler is off on Mac mini", 'scheduler off']
    ])
  })

  it.each<[string, PilotHostEntry[], string, string]>([
    [
      'is no longer answering',
      [LOCAL_NAMED, MINI_OFFLINE],
      "Mac mini isn't answering, so this automation can't be changed from here right now.",
      'not answering'
    ],
    [
      'is no longer connected',
      [LOCAL_NAMED, LINUX],
      "Mac mini isn't connected any more",
      'not connected'
    ]
  ])('disables a machine that loaded the job but %s', (_w, hosts, why, short) => {
    const { choices } = runNowChoices({ runsOn: null, hosts: [LOCAL_NAMED, MINI] }, hosts)
    expect(offered(choices)).toEqual([
      ['local', 'MacBook', null, null],
      ['env:mini', 'Mac mini', why, short]
    ])
  })

  it('refuses a machine gone from the hosts by its key, though another is named the same', () => {
    const other: PilotHostEntry = { ...MINI, key: 'env:mini2', target: { kind: 'local' } }
    const { choices } = runNowChoices({ runsOn: null, hosts: [LOCAL_NAMED, MINI, other] }, [
      LOCAL_NAMED,
      other
    ])
    expect(offered(choices)).toEqual([
      ['local', 'MacBook', null, null],
      ['env:mini', 'Mac mini', "Mac mini isn't connected any more", 'not connected'],
      ['env:mini2', 'Mac mini', null, null]
    ])
  })

  it('has no default when no machine can start it', () => {
    const hosts = [{ ...LOCAL_NAMED, schedulerOn: false }, MINI_OFF]
    expect(runNowChoices({ runsOn: 'Mac mini', hosts }, hosts).preferred).toBeNull()
    expect(runNowChoices({ runsOn: null, hosts: [] }, hosts)).toEqual({
      choices: [],
      preferred: null
    })
  })
})

describe('runNowPick', () => {
  const choices = runNowChoices({ runsOn: null, hosts: [LOCAL_NAMED, MINI, LINUX] }, [
    LOCAL_NAMED,
    MINI,
    { ...LINUX, schedulerOn: false }
  ])

  it.each<[string, string | null, string | null]>([
    ['the chosen machine', 'env:mini', 'env:mini'],
    ['nothing before anything is chosen', null, null],
    ['nothing once the chosen machine can no longer start it', 'env:linux', null],
    ['nothing once the chosen machine is gone', 'env:gone', null]
  ])('starts it on %s', (_w, chosen, key) =>
    expect(runNowPick(choices, chosen)?.host.key ?? null).toBe(key)
  )

  it('starts it on the only machine that has it, chosen or not', () => {
    const one = runNowChoices({ runsOn: null, hosts: [MINI] }, [LOCAL_NAMED, MINI])
    expect(runNowPick(one, null)?.host.key).toBe('env:mini')
  })

  it.each<[string, string | null, string]>([
    ["the chosen machine's reason", 'env:linux', "Pilot's scheduler is off on Linux box"],
    ['to pick one once the chosen machine is gone', 'env:gone', 'Pick a machine to start it on.']
  ])('says %s when it starts nowhere', (_w, chosen, why) =>
    expect(runNowHeld(choices, chosen)).toBe(why)
  )
})

describe('runNowBlocked', () => {
  it.each<[string, PilotHostEntry[], PilotHostEntry[], string | null]>([
    [
      'nothing while a machine can start it',
      [LOCAL_NAMED, MINI_OFF],
      [LOCAL_NAMED, MINI_OFF],
      null
    ],
    [
      "every machine's reason when none can",
      [{ ...LOCAL_NAMED, schedulerOn: false }, MINI_OFF],
      [{ ...LOCAL_NAMED, schedulerOn: false }, MINI_OFF],
      "Pilot's scheduler is off on MacBook · Pilot's scheduler is off on Mac mini"
    ],
    [
      'that no machine has it when none loaded it',
      [],
      [LOCAL_NAMED, MINI],
      'No connected Pilot can start this automation right now.'
    ]
  ])('says %s', (_w, loaded, hosts, why) =>
    expect(runNowBlocked(runNowChoices({ runsOn: null, hosts: loaded }, hosts))).toBe(why)
  )
})

describe('runNowAway', () => {
  const AWAY =
    "Fix CI runs on Mac mini; a run on MacBook can't hand over to it and may redo items it handled."
  it.each<[string, string | null, PilotHostEntry[], string, string | null]>([
    [
      'warns when the pick is not the runs_on machine',
      ' mac MINI ',
      [LOCAL_NAMED, MINI],
      'local',
      AWAY
    ],
    ['says nothing on the runs_on machine', 'Mac mini', [LOCAL_NAMED, MINI], 'env:mini', null],
    ['says nothing for a job without runs_on', null, [LOCAL_NAMED, MINI], 'local', null],
    ['says nothing with one machine to start it on', 'Mac mini', [LOCAL_NAMED], 'local', null]
  ])('%s', (_w, runsOn, loaded, chosen, line) => {
    const choices = runNowChoices({ runsOn, hosts: loaded }, [LOCAL_NAMED, MINI])
    const picked = runNowPick(choices, chosen)
    expect(runNowAway({ name: 'Fix CI', runsOn }, choices, picked)).toBe(line)
  })

  it('says nothing in a window with no machine to pick', () => {
    expect(runNowAway({ name: 'Fix CI', runsOn: 'Mac mini' }, undefined, null)).toBeNull()
  })
})
