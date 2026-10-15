import { describe, expect, it } from 'vitest'
import { PilotStore } from '../store/store'
import { cardRuns } from './card-runs'

describe('cardRuns', () => {
  it('gives each card its run with its steps, once per run, and nothing for a card without one', () => {
    const store = PilotStore.open(':memory:')
    store.runs.create({
      id: 'r1',
      automationId: 'a',
      tickId: null,
      itemKey: '!1',
      itemLabel: '!1',
      worktreePath: null,
      startedAt: 1,
      status: 'needs_you'
    })
    store.runs.createStep({
      runId: 'r1',
      idx: 0,
      name: 'fix',
      agent: 'claude',
      skill: null,
      startedAt: 1
    })
    const runs = cardRuns(store, [
      { runId: 'r1' },
      { runId: 'r1' },
      { runId: null },
      { runId: 'gone' }
    ])
    expect(Object.keys(runs)).toEqual(['r1'])
    expect(runs.r1.steps.map((s) => s.name)).toEqual(['fix'])
    store.close()
  })
})
