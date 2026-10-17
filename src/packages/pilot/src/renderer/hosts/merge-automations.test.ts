import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AutomationListPayload, AutomationSummary, TickRow } from '../../shared/api-types'
import { testRun } from '../../shared/run-views/__fixtures__/runs'
import { summary as fixCi } from '../pages/fixtures'
import { byHost, LOCAL_NAMED, MINI, MINI_OFFLINE } from './__fixtures__/hosts'
import type { HostRead } from './host-poll'
import type { PilotHostEntry } from './pilot-host'
import { resetPilotHostsFeed, setPilotHostsForTests } from './pilot-hosts-feed'

const pilotRpc = vi.fn()
vi.mock('../api', () => ({ pilotRpc: (...args: unknown[]) => pilotRpc(...args) }))

import { homeHost, loadMergedAutomations, mergeAutomationLists } from './merge-automations'

const summary = (over: Partial<AutomationSummary> = {}): AutomationSummary => ({
  ...fixCi,
  ...over
})
const list = (
  automations: AutomationSummary[],
  over: Partial<AutomationListPayload> = {}
): AutomationListPayload => ({
  automations,
  errors: [],
  peopleError: null,
  missingDirs: [],
  ...over
})
const read = (
  host: PilotHostEntry,
  value: AutomationListPayload | null
): HostRead<AutomationListPayload> => ({ host, value, error: null, seq: 1, startedSeq: 1 })
const tick = (startedAt: number): TickRow => ({
  id: startedAt,
  automationId: 'fix-ci',
  startedAt,
  finishedAt: startedAt + 1,
  status: 'ok',
  error: null,
  counts: {}
})

describe('homeHost', () => {
  it.each<[string, [PilotHostEntry, Partial<AutomationSummary>][], string]>([
    [
      'the machine that says it ticks it',
      [
        [LOCAL_NAMED, { ticksHere: false }],
        [MINI, { ticksHere: true }]
      ],
      'env:mini'
    ],
    [
      'the machine runs_on names, when none says',
      [
        [LOCAL_NAMED, { runsOn: 'mac mini' }],
        [MINI, { runsOn: 'mac mini' }]
      ],
      'env:mini'
    ],
    [
      'the machine runs_on names, whatever its spacing, beside an older host',
      [
        [LOCAL_NAMED, {}],
        [MINI, { runsOn: ' Mac mini ' }]
      ],
      'env:mini'
    ],
    [
      'this machine, for older hosts that say neither',
      [
        [LOCAL_NAMED, {}],
        [MINI, {}]
      ],
      'local'
    ],
    ['the only machine that loaded it', [[MINI, {}]], 'env:mini']
  ])('a row lives on %s', (_w, rows, key) =>
    expect(homeHost(rows.map(([host, s]) => ({ host, summary: summary(s) }))).key).toBe(key)
  )
})

describe('mergeAutomationLists', () => {
  it("makes one row per automation with every machine that loaded it, its home's schedule and switch, every machine's live runs and the newest tick", () => {
    const run = testRun({ id: 'r1', automationId: 'fix-ci' })
    const merged = mergeAutomationLists([
      read(
        LOCAL_NAMED,
        list([summary({ live: [run], lastTick: tick(200) }), summary({ id: 'local-only' })])
      ),
      read(
        MINI,
        list([
          summary({
            ticksHere: true,
            enabled: false,
            schedule: '0 * * * *',
            live: [run],
            lastTick: tick(100)
          })
        ])
      )
    ])
    expect(merged?.automations.map((a) => a.id)).toEqual(['fix-ci', 'local-only'])
    const row = merged?.automations[0]
    expect([row?.host.key, row?.hosts.map((h) => h.key)]).toEqual([
      'env:mini',
      ['local', 'env:mini']
    ])
    expect([row?.enabled, row?.schedule]).toEqual([false, '0 * * * *'])
    expect(row?.live.map((r) => [r.host.key, r.id])).toEqual([
      ['local', 'r1'],
      ['env:mini', 'r1']
    ])
    expect(row?.lastTick?.startedAt).toBe(200)
  })

  it('names the machine in each file problem when more than one machine answered', () => {
    const bad = list([], {
      errors: [{ file: '/a/bad.yaml', errors: ['/a/bad.yaml: no steps', 'line 3'] }],
      warnings: [{ file: '/a/w.yaml', warnings: ["/a/w.yaml: its arrow isn't drawn"] }],
      peopleError: 'people.yaml and people.yml both exist',
      missingDirs: ['/gone']
    })
    const problems = (reads: HostRead<AutomationListPayload>[]) => {
      const m = mergeAutomationLists(reads)
      return [m?.errors, m?.warnings, m?.peopleError, m?.missingDirs]
    }
    expect(problems([read(LOCAL_NAMED, list([])), read(MINI, bad)])).toEqual([
      [{ file: 'Mac mini: /a/bad.yaml', errors: ['Mac mini: /a/bad.yaml: no steps', 'line 3'] }],
      [{ file: 'Mac mini: /a/w.yaml', warnings: ["Mac mini: /a/w.yaml: its arrow isn't drawn"] }],
      'Mac mini: people.yaml and people.yml both exist',
      ['Mac mini: /gone']
    ])
    // One machine answered: its problems read as they always have.
    expect(problems([read(LOCAL_NAMED, null), read(MINI, bad)])).toEqual([
      bad.errors,
      bad.warnings,
      bad.peopleError,
      bad.missingDirs
    ])
  })

  it("is null until a machine has answered, and leaves out an unreachable machine's list and an answer that isn't one", () => {
    expect(mergeAutomationLists([read(LOCAL_NAMED, null)])).toBeNull()
    const notAList: AutomationListPayload = JSON.parse('{"items":[]}')
    const merged = mergeAutomationLists([
      read(LOCAL_NAMED, list([summary()])),
      read(MINI_OFFLINE, list([summary({ id: 'stale' })])),
      read({ ...MINI, key: 'env:other' }, notAList)
    ])
    expect(merged?.automations.map((a) => [a.id, a.hosts.map((h) => h.key)])).toEqual([
      ['fix-ci', ['local']]
    ])
  })
})

describe('loadMergedAutomations', () => {
  afterEach(() => {
    resetPilotHostsFeed()
    pilotRpc.mockReset()
  })

  it('asks every machine for its list now, and fails as the one call did when none answered', async () => {
    setPilotHostsForTests([LOCAL_NAMED, MINI])
    pilotRpc.mockImplementation(
      byHost({
        local: () => list([summary()]),
        mini: () => list([summary({ id: 'mini-only' })])
      })
    )
    const merged = await loadMergedAutomations()
    expect(merged.automations.map((a) => [a.id, a.host.key])).toEqual([
      ['fix-ci', 'local'],
      ['mini-only', 'env:mini']
    ])
    expect(pilotRpc).toHaveBeenCalledWith('pilot.automations.list')

    setPilotHostsForTests([LOCAL_NAMED])
    pilotRpc.mockRejectedValue(new Error('timed out'))
    await expect(loadMergedAutomations()).rejects.toThrow('timed out')
  })

  it('names every machine whose list it lacks: one whose read failed, and one offline', async () => {
    const studio = { ...MINI_OFFLINE, key: 'env:studio', machineName: 'Studio' }
    setPilotHostsForTests([LOCAL_NAMED, MINI, studio])
    pilotRpc.mockImplementation(
      byHost({
        local: () => list([summary()]),
        mini: () => {
          throw new Error('timed out')
        }
      })
    )
    const merged = await loadMergedAutomations()
    expect(merged.failedHosts.map((h) => h.machineName)).toEqual(['Mac mini', 'Studio'])
    setPilotHostsForTests([LOCAL_NAMED])
    pilotRpc.mockResolvedValue(list([summary()]))
    expect((await loadMergedAutomations()).failedHosts).toEqual([])
  })
})
