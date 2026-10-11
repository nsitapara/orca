import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'

describe('EventStore', () => {
  it("tells a run's events oldest first, with their payloads", () => {
    const { events } = PilotStore.open(':memory:')
    const second = events.add({ at: 20, kind: 'step.done', runId: 'r1', payload: { step: 'fix' } })
    const first = events.add({
      at: 10,
      kind: 'run.started',
      runId: 'r1',
      automationId: 'a',
      itemKey: 'mr:1'
    })
    events.add({ at: 15, kind: 'run.started', runId: 'r2' })
    expect(events.forRun('r1')).toEqual([
      {
        id: first,
        at: 10,
        automationId: 'a',
        runId: 'r1',
        worktreePath: null,
        itemKey: 'mr:1',
        kind: 'run.started',
        payload: {}
      },
      {
        id: second,
        at: 20,
        automationId: null,
        runId: 'r1',
        worktreePath: null,
        itemKey: null,
        kind: 'step.done',
        payload: { step: 'fix' }
      }
    ])
  })

  it("lists a worktree's events newest first, back to a time", () => {
    const { events } = PilotStore.open(':memory:')
    events.add({ at: 5, kind: 'old', worktreePath: '/wt' })
    events.add({ at: 10, kind: 'a', worktreePath: '/wt' })
    events.add({ at: 30, kind: 'b', worktreePath: '/wt' })
    events.add({ at: 20, kind: 'other', worktreePath: '/elsewhere' })
    expect(events.forWorktree('/wt', 10).map((e) => e.kind)).toEqual(['b', 'a'])
  })

  it('lists events by run, kind and time, oldest first, up to a limit', () => {
    const { events } = PilotStore.open(':memory:')
    events.add({ at: 10, kind: 'run.started', runId: 'r1' })
    events.add({ at: 20, kind: 'step.done', runId: 'r1' })
    events.add({ at: 30, kind: 'run.ended', runId: 'r1' })
    events.add({ at: 25, kind: 'step.done', runId: 'r2' })
    expect(events.list({ runId: 'r1' }).map((e) => e.kind)).toEqual([
      'run.started',
      'step.done',
      'run.ended'
    ])
    expect(events.list({ kinds: ['step.done'] }).map((e) => e.at)).toEqual([20, 25])
    expect(events.list({ since: 25 }).map((e) => e.at)).toEqual([25, 30])
    expect(events.list({ runId: 'r1', limit: 2 }).map((e) => e.at)).toEqual([10, 20])
    expect(events.list({ kinds: [] })).toEqual([])
  })
})
