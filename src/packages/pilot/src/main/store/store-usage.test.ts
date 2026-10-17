import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import Database from '../../../../../main/sqlite/sync-database'
import type { UsageBucket } from '../usage/buckets'
import { PilotStore } from './store'

const bucket = (model: string, input: number, costUsd: number | null): UsageBucket => ({
  day: '2026-10-11',
  model,
  requests: 1,
  input,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  costUsd
})

function setup(): { store: PilotStore; file: string } {
  const file = join(mkdtempSync(join(tmpdir(), 'pilot-usage-')), 'db.sqlite')
  const store = PilotStore.open(file)
  store.runs.create({
    id: 'r1',
    automationId: 'a',
    tickId: null,
    itemKey: 'mr:1',
    itemLabel: '!1 web-1',
    worktreePath: '/wt',
    startedAt: 1
  })
  for (const idx of [0, 1]) {
    store.runs.createStep({
      runId: 'r1',
      idx,
      name: `step${idx + 1}`,
      agent: 'claude',
      skill: null,
      startedAt: 10
    })
  }
  return { store, file }
}

describe('UsageStore', () => {
  it('is schema 14', () => {
    expect(setup().store.schemaVersion()).toBe(14)
  })

  it('lists agent steps that ended and were never measured', () => {
    const { store, file } = setup()
    store.runs.updateStep('r1', 0, {
      status: 'done',
      finishedAt: 20,
      sessionId: 's0',
      transcriptPath: '/t/s0.jsonl'
    })
    store.runs.updateStep('r1', 1, { status: 'running' })
    expect(store.usage.unmeasuredSteps()).toEqual([
      {
        runId: 'r1',
        idx: 0,
        agent: 'claude',
        sessionId: 's0',
        transcriptPath: '/t/s0.jsonl',
        startedAt: 10,
        finishedAt: 20
      }
    ])
    new Database(file).prepare("UPDATE steps SET kind = 'shell' WHERE idx = 0").run()
    expect(store.usage.unmeasuredSteps()).toEqual([])
  })

  it("saves a step's buckets and totals once, and the run's cost becomes the sum of its steps", () => {
    const { store } = setup()
    store.runs.updateStep('r1', 0, { status: 'done', finishedAt: 20 })
    store.runs.updateStep('r1', 1, { status: 'done', finishedAt: 30 })
    store.usage.saveStepUsage('r1', 0, [bucket('claude-opus-5-5', 100, 1.5)], true, 40)
    store.usage.saveStepUsage(
      'r1',
      1,
      [bucket('claude-haiku-4-5', 50, 0.25), bucket('mystery', 10, null)],
      true,
      41
    )
    expect(store.runs.steps('r1').map((s) => [s.costUsd, s.tokens, s.model])).toEqual([
      [1.5, 100, 'claude-opus-5-5'],
      [0.25, 60, 'claude-haiku-4-5']
    ])
    expect(store.runs.get('r1')).toMatchObject({ costUsd: 1.75, tokens: 160 })
    expect(store.usage.stepBuckets('r1', 1).map((b) => b.model)).toEqual([
      'claude-haiku-4-5',
      'mystery'
    ])
    expect(store.usage.unmeasuredSteps()).toEqual([])
    expect(store.usage.lastMeasuredAt()).toBe(41)
  })

  it('a step whose session is gone keeps the cost it already had, and the run keeps its sum', () => {
    const { store } = setup()
    store.runs.updateStep('r1', 0, { status: 'done', finishedAt: 20, costUsd: 2, tokens: 50 })
    store.usage.saveStepUsage('r1', 0, [], false, 60)
    expect(store.runs.steps('r1')[0]).toMatchObject({ costUsd: 2, tokens: 50 })
    expect(store.runs.get('r1')).toMatchObject({ costUsd: 2, tokens: 50 })
    expect(store.usage.unmeasuredSteps()).toEqual([])
  })

  it('a step whose session was never found has no cost and no tokens, but counts as measured', () => {
    const { store } = setup()
    store.runs.updateStep('r1', 0, { status: 'failed', finishedAt: 20 })
    store.usage.saveStepUsage('r1', 0, [], false, 50)
    expect(store.runs.steps('r1')[0]).toMatchObject({ costUsd: null, tokens: null })
    expect(store.runs.get('r1')).toMatchObject({ costUsd: null, tokens: null })
    expect(store.usage.unmeasuredSteps()).toEqual([])
  })
})
