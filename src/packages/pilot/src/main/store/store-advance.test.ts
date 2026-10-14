import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PilotStore } from './store'
import type { AdvancedStep } from './store-advance'

function setup() {
  const path = join(mkdtempSync(join(tmpdir(), 'pilot-advance-store-')), 'db.sqlite')
  const store = PilotStore.open(path)
  store.runs.create({
    id: 'r1',
    automationId: 'a',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1',
    worktreePath: '/wt',
    startedAt: 1
  })
  return { store }
}

function step(idx: number, agent = 'claude'): AdvancedStep {
  return {
    runId: 'r1',
    idx,
    name: `s${idx}`,
    agent,
    skill: null,
    mode: null,
    whenExpr: null,
    at: 5
  }
}

function addStep(
  store: PilotStore,
  idx: number,
  patch: Parameters<PilotStore['runs']['updateStep']>[2] = {}
): void {
  store.runs.createStep({
    runId: 'r1',
    idx,
    name: `s${idx}`,
    agent: 'claude',
    skill: null,
    startedAt: 1
  })
  store.runs.updateStep('r1', idx, patch)
}

describe('AdvanceStore', () => {
  it('recordSkippedStep writes a finished skipped row with its reason and kind', () => {
    const { store } = setup()
    store.advance.recordSkippedStep(
      { ...step(0, 'shell'), whenExpr: '{x} == 1' },
      'when: {x} == 1 is false'
    )
    expect(store.runs.steps('r1')[0]).toMatchObject({
      status: 'skipped',
      error: 'when: {x} == 1 is false',
      kind: 'shell',
      whenExpr: '{x} == 1',
      startedAt: 5,
      finishedAt: 5
    })
  })

  it('ensureFailedStep adds a missing row, fails an open one, and never overwrites a closed one', () => {
    const { store } = setup()
    store.advance.ensureFailedStep(step(0), 'no worktree')
    addStep(store, 1)
    store.advance.ensureFailedStep(step(1), 'launch threw')
    addStep(store, 2, { status: 'failed', error: 'its own error', finishedAt: 3 })
    store.advance.ensureFailedStep(step(2), 'a later error')
    addStep(store, 3, { status: 'pending' })
    store.advance.ensureFailedStep(step(3), 'the workspace could not be made')
    expect(store.runs.steps('r1').map((s) => [s.status, s.error])).toEqual([
      ['failed', 'no worktree'],
      ['failed', 'launch threw'],
      ['failed', 'its own error'],
      ['failed', 'the workspace could not be made']
    ])
  })

  it.each([
    [
      'null when no step is priced',
      [
        [null, null],
        [null, null]
      ],
      { costUsd: null, tokens: null }
    ],
    [
      'the sum of the priced steps',
      [
        [1.5, 100],
        [null, null],
        [0.25, 20]
      ],
      { costUsd: 1.75, tokens: 120 }
    ]
  ] as [string, [number | null, number | null][], unknown][])(
    'rollupCost is %s',
    (_n, costs, expected) => {
      const { store } = setup()
      costs.forEach(([costUsd, tokens], idx) =>
        addStep(store, idx, { status: 'done', costUsd, tokens })
      )
      expect(store.advance.rollupCost('r1')).toEqual(expected)
    }
  )

  it('runsAwaitingAdvance lists running runs whose steps have all ended', () => {
    const { store } = setup()
    for (const [id, status, stepStatus] of [
      ['ended', 'running', 'done'],
      ['busy', 'running', 'running'],
      ['finished', 'done', 'done']
    ] as const) {
      store.runs.create({
        id,
        automationId: 'a',
        tickId: null,
        itemKey: id,
        itemLabel: id,
        worktreePath: null,
        startedAt: 2
      })
      store.runs.createStep({
        runId: id,
        idx: 0,
        name: 's0',
        agent: 'claude',
        skill: null,
        startedAt: 2
      })
      store.runs.updateStep(id, 0, { status: stepStatus })
      store.runs.update(id, { status })
    }
    expect(store.advance.runsAwaitingAdvance().map((r) => r.id)).toEqual(['ended'])
  })

  it('mergeStepOutputs merges into the step and refuses a step that does not exist', () => {
    const { store } = setup()
    addStep(store, 0)
    store.advance.mergeStepOutputs('r1', 0, { changed: true })
    expect(store.advance.mergeStepOutputs('r1', 0, { report: 'a.md' })).toEqual({
      changed: true,
      report: 'a.md'
    })
    expect(store.runs.steps('r1')[0].outputs).toEqual({ changed: true, report: 'a.md' })
    expect(() => store.advance.mergeStepOutputs('r1', 4, { x: 1 })).toThrow('Run r1 has no step 4')
  })

  it('tickItemFields returns the fields a tick recorded for the item, or null', () => {
    const { store } = setup()
    const tickId = store.startTick('a', 1)
    store.recordDecisions(
      tickId,
      [
        {
          key: 'mr:1',
          label: '!1',
          verdict: 'started',
          reason: '',
          checks: [],
          onceKey: '1:9',
          fields: { 'mr.iid': 1 }
        }
      ],
      new Map()
    )
    expect(store.advance.tickItemFields(tickId, 'mr:1')).toEqual({ 'mr.iid': 1 })
    expect(store.advance.tickItemFields(tickId, 'mr:2')).toBeNull()
  })
})
