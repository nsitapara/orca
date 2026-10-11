import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'

describe('RunStore.sessionStepsAnyIn', () => {
  it("finds every automation's open or recently finished steps in one worktree", () => {
    const store = PilotStore.open(':memory:')
    const runIn = (id: string, automationId: string, worktreePath: string) => {
      store.runs.create({
        id,
        automationId,
        tickId: null,
        itemKey: id,
        itemLabel: id,
        worktreePath,
        startedAt: 1
      })
      store.runs.createStep({
        runId: id,
        idx: 0,
        name: 's',
        agent: 'claude',
        skill: null,
        startedAt: 1
      })
    }
    runIn('a-1', 'a', '/wt')
    runIn('b-1', 'b', '/wt')
    runIn('b-2', 'b', '/wt')
    runIn('c-1', 'c', '/other')
    store.runs.updateStep('b-1', 0, { status: 'done', terminalHandle: 't-b1', finishedAt: 100 })
    store.runs.updateStep('b-2', 0, { status: 'done', terminalHandle: 't-b2', finishedAt: 5 })
    expect(store.runs.sessionStepsAnyIn('/wt', 50).map((s) => s.runId)).toEqual(['a-1', 'b-1'])
  })
})
