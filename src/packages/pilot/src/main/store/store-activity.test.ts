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

  it.each<[string, boolean, 'ok' | 'failed', boolean]>([
    ['skipped, held and warned', true, 'ok', false],
    ['started a run', false, 'ok', true],
    ['failed', false, 'failed', false]
  ])('counts a re-check tick that %s as quiet: %s', (_name, quiet, status, startedRun) => {
    store = PilotStore.open(':memory:')
    const id = store.startTick('a', 100, true)
    store.finishTick(id, status, null, { skipped: 1, held: 1 }, 101, ['a source warned'])
    if (startedRun) {
      run('r', { tickId: id })
    }
    expect(store.activity.ticks(['a'], 0, 10, true).map((t) => t.id)).toEqual(quiet ? [] : [id])
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

  // "Hide automation runs": a step's pane key is `<tabId>:<leafId>`.
  it('finds the tabs a step ran in, by whole tab id', () => {
    store = PilotStore.open(':memory:')
    run('r1')
    store.runs.createStep({
      runId: 'r1',
      idx: 0,
      name: 'a',
      agent: 'claude',
      skill: null,
      startedAt: 1
    })
    store.runs.updateStep('r1', 0, { paneKey: 'tab-1:leaf' })
    store.runs.createStep({
      runId: 'r1',
      idx: 1,
      name: 'b',
      agent: 'claude',
      skill: null,
      startedAt: 2
    })
    expect(store.activity.automationTabs(['tab-1', 'tab', 'tab-2', 'person'])).toEqual(['tab-1'])
    expect(store.activity.automationTabs([])).toEqual([])
  })
})
