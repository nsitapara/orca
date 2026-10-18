import { afterEach, describe, expect, it } from 'vitest'
import type { RunRow } from '../../shared/api-types'
import { PilotStore } from './store'

let store: PilotStore

function run(id: string, over: Partial<RunRow> = {}): void {
  store.runs.create({
    id,
    automationId: 'a',
    tickId: null,
    itemKey: id,
    itemLabel: id,
    worktreePath: null,
    startedAt: 10,
    ...over
  })
}

function tick(automationId: string, at: number, counts: Record<string, number>): number {
  const id = store.startTick(automationId, at)
  store.finishTick(id, 'ok', null, counts, at + 1)
  return id
}

describe('ActivityStore', () => {
  afterEach(() => store.close())

  it('lists the ticks of the named automations since a time, newest first, leaving out quiet ones (nothing due, or only held) on request', () => {
    store = PilotStore.open(':memory:')
    const quiet = tick('a', 100, { notdue: 2 })
    const held = tick('a', 150, { held: 1, notdue: 1 })
    const busy = tick('b', 200, { started: 1 })
    const other = tick('c', 300, { started: 1 })
    tick('a', 50, { started: 1 })
    expect(store.activity.ticks(['a', 'b'], 60, 10, false).map((t) => t.id)).toEqual([
      busy,
      held,
      quiet
    ])
    expect(store.activity.ticks(['a', 'b'], 60, 10, true).map((t) => t.id)).toEqual([busy])
    expect(store.activity.ticks(null, 0, 2, false).map((t) => t.id)).toEqual([other, busy])
  })

  it('lists live runs of any age, the runs no tick started, and the runs answering a run', () => {
    store = PilotStore.open(':memory:')
    run('old-asking', { status: 'asking', startedAt: 1 })
    run('waiting', { status: 'needs_you', startedAt: 5 })
    run('done', { status: 'done', startedAt: 20 })
    run('answer', { trigger: 'answer', parentRunId: 'done', startedAt: 30 })
    run('other', { automationId: 'b', startedAt: 40 })
    expect(store.activity.live(['a']).map((r) => r.id)).toEqual(['answer', 'waiting', 'old-asking'])
    expect(store.activity.unticked(null, 15, 10).map((r) => r.id)).toEqual([
      'other',
      'answer',
      'done'
    ])
    expect(store.activity.children('done').map((r) => r.id)).toEqual(['answer'])
  })
})
