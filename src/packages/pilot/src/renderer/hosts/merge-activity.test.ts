import { describe, expect, it } from 'vitest'
import type { ActivityPayload, ActivityRun, ActivityTick, ListedRun } from '../../shared/api-types'
import { testRun } from '../../shared/run-views/__fixtures__/runs'
import { groupActivity } from '../run-views/activity-groups'
import { LOCAL_NAMED, MINI, MINI_OFFLINE } from './__fixtures__/hosts'
import type { HostRead } from './host-poll'
import { hostedRunKey, mergeActivity } from './merge-activity'
import { hostOf, type PilotHostEntry } from './pilot-host'

const NOW = new Date(2026, 9, 17, 15, 0).getTime()
const HOUR = 3_600_000
const at = (hoursAgo: number): number => NOW - hoursAgo * HOUR

const run = (
  id: string,
  status: ActivityRun['status'],
  over: Partial<ListedRun> = {}
): ListedRun => ({
  ...testRun({ id, status, automationId: 'ci', startedAt: at(1), ...over }),
  fields: {}
})
const tickAt = (id: number, startedAt: number, runs: ActivityRun[] = []): ActivityTick => ({
  id,
  automationId: 'ci',
  startedAt,
  finishedAt: startedAt + 1,
  status: 'ok',
  error: null,
  counts: { started: runs.length },
  items: [],
  runs
})
const tickWith = (...runs: ActivityRun[]): ActivityTick => tickAt(1, at(1), runs)
const read = (
  host: PilotHostEntry,
  value: Partial<ActivityPayload> | null
): HostRead<ActivityPayload> => ({
  host,
  value: value && { live: [], ticks: [], loose: [], reach: null, ...value },
  error: null,
  seq: 1,
  startedSeq: 1
})

describe('mergeActivity', () => {
  it("keeps two machines' runs that share an id apart (Review Focus 1)", () => {
    const merged = mergeActivity([
      read(LOCAL_NAMED, { live: [run('ci-202610171010-t1-0', 'running')] }),
      read(MINI, { ticks: [tickWith(run('ci-202610171010-t1-0', 'done'))] })
    ])!
    const g = groupActivity(merged, NOW, hostedRunKey)
    expect(g.running.map((r) => hostOf(r).key)).toEqual(['local'])
    expect(
      g.days[0].entries[0].kind === 'tick' &&
        g.days[0].entries[0].tick.runs.map((r) => hostOf(r).key)
    ).toEqual(['env:mini'])
  })

  it('cuts the merged list at the latest reach, so no machine looks emptier than it is', () => {
    const merged = mergeActivity([
      read(LOCAL_NAMED, {
        live: [run('old-live', 'running', { startedAt: at(30) })],
        ticks: [tickAt(2, at(1)), tickAt(1, at(4))],
        loose: [
          run('answer', 'done', { startedAt: at(2) }),
          run('older', 'done', { startedAt: at(4) })
        ],
        reach: at(4)
      }),
      read(MINI, {
        ticks: [tickAt(2, at(2)), tickAt(1, at(3))],
        loose: [run('mini-answer', 'done', { startedAt: at(2.5) })],
        reach: at(3)
      })
    ])
    expect(merged?.reach).toBe(at(3))
    expect(merged?.ticks.map((t) => [t.host.key, t.startedAt])).toEqual([
      ['local', at(1)],
      ['env:mini', at(2)],
      ['env:mini', at(3)]
    ])
    expect(merged?.loose.map((r) => r.id)).toEqual(['answer', 'mini-answer'])
    // Live runs are of any age on every machine, so none is cut.
    expect(merged?.live.map((r) => r.id)).toEqual(['old-live'])
    // No machine's page was full: nothing is cut.
    const whole = mergeActivity([read(LOCAL_NAMED, { ticks: [tickAt(1, at(40))] }), read(MINI, {})])
    expect([whole?.reach, whole?.ticks.length]).toEqual([null, 1])
  })

  it('tags every tick and the runs inside it with its machine, newest tick first', () => {
    const merged = mergeActivity([
      read(LOCAL_NAMED, {
        ticks: [tickAt(7, at(2), [run('r1', 'done')])],
        loose: [run('a1', 'done')]
      }),
      read(MINI, {
        live: [run('r2', 'running')],
        ticks: [tickAt(7, at(1), [run('r1', 'failed')])]
      })
    ])
    expect(merged?.ticks.map((t) => [t.host.key, t.id, t.runs.map((r) => r.host.key)])).toEqual([
      ['env:mini', 7, ['env:mini']],
      ['local', 7, ['local']]
    ])
    expect([...(merged?.live ?? []), ...(merged?.loose ?? [])].map(hostedRunKey)).toEqual([
      'env:mini/r2',
      'a1'
    ])
  })

  it("is null until a machine has answered, keeps a machine's last activity through a failed read, and never an unreachable machine's", () => {
    expect(mergeActivity([read(LOCAL_NAMED, null)])).toBeNull()
    const merged = mergeActivity([
      read(LOCAL_NAMED, {}),
      { ...read(MINI, { live: [run('m1', 'running')] }), error: 'timed out' },
      read({ ...MINI_OFFLINE, key: 'env:gone' }, { live: [run('stale', 'running')] })
    ])
    expect(merged?.live.map(hostedRunKey)).toEqual(['env:mini/m1'])
  })
})
