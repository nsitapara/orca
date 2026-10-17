import { describe, expect, it } from 'vitest'
import type { ActivityPayload, ActivityTick, ListedRun } from '../../shared/api-types'
import { stepAt, testCard, testRun } from '../../shared/run-views/__fixtures__/runs'
import { LOCAL_NAMED, MINI } from '../hosts/__fixtures__/hosts'
import { hostedRunKey } from '../hosts/merge-activity'
import {
  dayLabel,
  defaultRun,
  groupActivity,
  jobCode,
  runCandidates,
  weekStart
} from './activity-groups'

const NOW = new Date(2026, 9, 15, 15, 0).getTime()
const HOUR = 3_600_000
const listed = (over: Partial<ListedRun>): ListedRun => ({ ...testRun(over), fields: {} })
const tick = (id: number, at: number, runs: ActivityTick['runs'] = []): ActivityTick => ({
  id,
  automationId: 'job',
  startedAt: at,
  finishedAt: at + 1,
  status: 'ok',
  error: null,
  counts: { started: runs.length },
  items: [],
  runs
})

describe('groupActivity', () => {
  it('splits live runs into running and waiting, and puts the rest under their day, newest first', () => {
    const running = listed({ id: 'a', status: 'running', startedAt: NOW - HOUR })
    const askingStep = listed({ id: 'b', status: 'running', inbox: [testCard({ runId: 'b' })] })
    const askingFirst = listed({ id: 'c', status: 'asking' })
    const p: ActivityPayload = {
      live: [running, askingStep, askingFirst],
      ticks: [
        tick(2, NOW - 2 * HOUR, [testRun({ id: 'a' }), testRun({ id: 'done' })]),
        tick(1, NOW - 30 * HOUR)
      ],
      loose: [listed({ id: 'answer', startedAt: NOW - HOUR, status: 'done' })],
      reach: null
    }
    const g = groupActivity(p, NOW)
    expect(g.running.map((r) => r.id)).toEqual(['a'])
    expect(g.waiting.map((r) => r.id)).toEqual(['b', 'c'])
    expect(
      g.days.map((d) => [
        d.label,
        d.entries.map((e) => (e.kind === 'tick' ? `t${e.tick.id}` : e.run.id))
      ])
    ).toEqual([
      ['Earlier today', ['answer', 't2']],
      ['Yesterday', ['t1']]
    ])
    const today = g.days[0].entries[1]
    expect(today.kind === 'tick' ? today.tick.runs.map((r) => r.id) : []).toEqual(['done'])
  })

  it('names days and the start of the week Activity reads from', () => {
    expect(dayLabel(NOW - 3 * 24 * HOUR, NOW)).toMatch(/Monday|Mon/)
    expect(new Date(weekStart(NOW)).toDateString()).toBe(new Date(2026, 9, 9).toDateString())
  })
})

describe('run picking', () => {
  it('offers live runs and recent ones once each, newest first, and picks the running one', () => {
    const p: ActivityPayload = {
      live: [
        listed({ id: 'waiting', status: 'needs_you', startedAt: 30 }),
        listed({ id: 'running', status: 'running', startedAt: 20 })
      ],
      ticks: [
        tick(1, 10, [
          testRun({ id: 'running', startedAt: 20 }),
          testRun({ id: 'old', status: 'done', startedAt: 10, steps: [stepAt(0, 'fix', 'done')] })
        ])
      ],
      loose: [],
      reach: null
    }
    const runs = runCandidates(p)
    expect(runs.map((r) => r.id)).toEqual(['waiting', 'running', 'old'])
    expect(defaultRun(runs)).toBe('running')
    expect(defaultRun(runs.slice(2))).toBe('old')
    expect(defaultRun([])).toBeNull()
  })

  it("offers two machines' runs that share an id, each once, and picks the running one by its machine", () => {
    const local = { ...listed({ id: 'r1', status: 'done', startedAt: 20 }), host: LOCAL_NAMED }
    const mini = { ...listed({ id: 'r1', status: 'running', startedAt: 10 }), host: MINI }
    const p: ActivityPayload = {
      live: [mini],
      ticks: [tick(1, 10, [mini])],
      loose: [local],
      reach: null
    }
    const runs = runCandidates(p, 10, hostedRunKey)
    expect(runs.map(hostedRunKey)).toEqual(['r1', 'env:mini/r1'])
    expect(defaultRun(runs, hostedRunKey)).toBe('env:mini/r1')
  })

  it("takes a job's code from its name", () => {
    expect([jobCode('05 · Fix failed CI'), jobCode('Pull dev')]).toEqual(['05', 'Pull dev'])
  })
})
